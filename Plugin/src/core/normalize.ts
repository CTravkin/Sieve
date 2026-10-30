import { lowerRune } from './unicode-lower.ts';
import { combiningClass, composeRunes, decomposeRune, nonStarterCounts } from './unicode-normalization.ts';
import type { Platform } from './types.ts';

export function nativeNormalize(text: string, platform: Platform): string {
  // ASCII is already normalized in every pinned platform form.
  if (!/[\u0080-\uffff]/.test(text)) return text;
  const decomposed: number[] = [];
  let streamSafe = 0;
  const append = (rune: number): void => {
    const ccc = combiningClass(rune); let index = decomposed.length;
    // Stable canonical ordering, bounded by native stream-safe segment length.
    if (ccc) while (index > 0 && combiningClass(decomposed[index-1]) > ccc) index--;
    decomposed.splice(index,0,rune);
  };
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    const [lead, trail] = nonStarterCounts(cp);
    if (streamSafe + lead > 30) { append(0x034f); streamSafe = 0; }
    streamSafe += lead;
    if (!lead) streamSafe = trail;
    const syllable = cp - 0xac00;
    if (syllable >= 0 && syllable < 11172) {
      append(0x1100 + Math.floor(syllable / 588)); append(0x1161 + Math.floor((syllable % 588) / 28));
      if (syllable % 28) append(0x11a7 + syllable % 28);
    } else for (const rune of decomposeRune(cp) ?? [cp]) append(rune);
  }
  if (platform === 'darwin' || platform === 'ios') return decomposed.map(cp => String.fromCodePoint(cp)).join('');
  const composed: number[] = [];
  let starter = -1; let lastClass = 0;
  for (const rune of decomposed) {
    const ccc = combiningClass(rune);
    let combined: number | undefined;
    if (starter !== -1 && (lastClass < ccc || lastClass === 0)) {
      const first = composed[starter];
      const l = first - 0x1100; const v = rune - 0x1161;
      if (l >= 0 && l < 19 && v >= 0 && v < 21) combined = 0xac00 + (l*21+v)*28;
      else if (first >= 0xac00 && first <= 0xd7a3 && (first-0xac00)%28 === 0 && rune > 0x11a7 && rune < 0x11c3) combined = first + rune - 0x11a7;
      else combined = composeRunes(first,rune);
    }
    if (combined !== undefined) composed[starter] = combined;
    else {
      if (!ccc) starter = composed.length;
      composed.push(rune); lastClass = ccc;
    }
  }
  return composed.map(cp => String.fromCodePoint(cp)).join('');
}

export function foldCase(text: string): string {
  let lower = '';
  for (const r of text) {
    const cp = r.codePointAt(0)!;
    lower += String.fromCodePoint(lowerRune(cp));
  }
  return lower;
}

export function defaultCaseFold(platform: Platform): boolean {
  return platform === 'windows' || platform === 'darwin' || platform === 'ios';
}

export function toSlash(path: string, platform: Platform): string {
  return platform === 'windows' ? path.replace(/\\/g, '/') : path;
}

/** Go strings.TrimSpace differs from JS trim: BOM stays; NEL is whitespace. */
export function trimSpace(text: string): string {
  return text.replace(/^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, '');
}

/** Lexical Go filepath.Join/Clean, using forward slashes at the reader boundary. */
export function joinPath(platform: Platform, ...elements: string[]): string {
  const text = elements.filter(x => x !== '').map(x => toSlash(x, platform)).join('/');
  let prefix = ''; let rest = text;
  if (platform === 'windows') {
    const volume = /^[a-zA-Z]:/.exec(rest)?.[0];
    if (volume) { prefix = volume; rest = rest.slice(2); }
    else if (rest.startsWith('//')) {
      const unc = /^\/\/[^/]+\/[^/]+/.exec(rest)?.[0];
      if (unc) { prefix = unc; rest = rest.slice(unc.length); }
    }
  }
  const rooted = rest.startsWith('/');
  const parts: string[] = [];
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!rooted) parts.push(part);
    } else parts.push(part);
  }
  let result = prefix + (rooted ? '/' : '') + parts.join('/');
  if (result === '') result = '.';
  // Windows Clean prevents a colon in a relative first element becoming a drive volume.
  if (platform === 'windows' && !prefix && !rooted && parts[0]?.includes(':')) result = './' + result;
  return result;
}

export function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '.' : path.slice(0, slash) || '/';
}

export function relativePath(root: string, path: string): string {
  const from = root.split('/'); const to = path.split('/');
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common++;
  return [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/') || '.';
}

/** Keep invalid bytes distinct until the glob lexer rejects them, just like Go strings. */
function decodeGoUTF8(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i];
    if (first < 0x80) { result += String.fromCharCode(first); i++; continue; }
    const width = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
    let cp = first & (0x7f >> width); let valid = width > 0 && i + width <= bytes.length;
    for (let j = 1; valid && j < width; j++) { const b = bytes[i+j]; if ((b & 0xc0) !== 0x80) valid = false; else cp = (cp << 6) | (b & 0x3f); }
    if (cp < [0,0,0x80,0x800,0x10000][width] || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) valid = false;
    if (valid) { result += String.fromCodePoint(cp); i += width; }
    else { result += String.fromCharCode(0xdc00 + first); i++; }
  }
  return result;
}

export function scanLines(content: string | Uint8Array): { text: string; bytes: number }[] {
  const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const lines: { text: string; bytes: number }[] = [];
  let start = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 10) { lines.push({ text: decodeGoUTF8(data.subarray(start,i)), bytes: i-start }); start = i+1; }
  }
  if (start < data.length) lines.push({ text: decodeGoUTF8(data.subarray(start)), bytes: data.length-start });
  return lines;
}

const roundConstants = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
];

/** Portable SHA-256: no host crypto/Node dependency in compilation or runtime. */
export function sha256(content: string | Uint8Array): string {
  const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const bytes = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  bytes.set(data); bytes[data.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 8, Math.floor(data.length / 0x20000000));
  view.setUint32(bytes.length - 4, (data.length * 8) >>> 0);
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const w = new Uint32Array(64);
  const rotate = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]; const b = w[i - 2];
      w[i] = (w[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = hash as [number,number,number,number,number,number,number,number];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + roundConstants[i] + w[i]) >>> 0;
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    const next = [a,b,c,d,e,f,g,h];
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + next[i]) >>> 0;
  }
  return hash.map(n => n.toString(16).padStart(8, '0')).join('');
}
