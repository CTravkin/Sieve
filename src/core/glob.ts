/*! @license Copyright (c) 2016 Sergey Kamardin; cal mh/glob 1d823af5017b, MIT; see THIRD-PARTY-NOTICES.md */
// Copyright (c) 2016 Sergey Kamardin. MIT; full notice in THIRD-PARTY-NOTICES.md.
// Native optimizer behavior (including UTF-8 byte offsets) is part of this pinned contract.

type Kind = 'pattern' | 'anyof' | 'text' | 'any' | 'super' | 'single' | 'list' | 'range' | 'nothing' | 'row' | 'every' | 'min' | 'max' | 'contains' | 'prefix' | 'suffix' | 'prefixAny' | 'suffixAny' | 'prefixSuffix' | 'btree';
interface Node { kind: Kind; text?: string; not?: boolean; lo?: number; hi?: number; children?: Node[] }
interface Glob {
  kind: Kind; len: number; text?: string; suffix?: string; not?: boolean; lo?: number; hi?: number;
  sep?: number[]; list?: number[]; children?: Glob[]; value?: Glob; left?: Glob; right?: Glob; limit?: number;
}
type Index = [number, number[]];
const none = (): Index => [-1, []];
const encode = (s: string): string => Array.from(new TextEncoder().encode(s), b => String.fromCharCode(b)).join('');
const byteLength = (r: number): number => r < 0x80 ? 1 : r < 0x800 ? 2 : r < 0x10000 ? 3 : 4;

// Go DecodeRuneInString returns RuneError with width 1 for each invalid byte.
function decode(s: string, index = 0): [number, number] {
  if (index >= s.length) return [0xfffd, 0];
  const first = s.charCodeAt(index);
  if (first < 0x80) return [first, 1];
  const width = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
  if (!width || index + width > s.length) return [0xfffd, 1];
  let cp = first & (0x7f >> width);
  for (let j = 1; j < width; j++) {
    const b = s.charCodeAt(index + j);
    if ((b & 0xc0) !== 0x80) return [0xfffd, 1];
    cp = (cp << 6) | (b & 0x3f);
  }
  if (cp < [0,0,0x80,0x800,0x10000][width]! || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return [0xfffd, 1];
  return [cp, width];
}

function runes(s: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < s.length;) { const [r, w] = decode(s, i); out.push([i, r, w]); i += w; }
  return out;
}
const count = (s: string): number => runes(s).length;
const ends = (s: string): number[] => [...runes(s).map(([i]) => i), s.length];
const runeEnds = (s: string): number[] => runes(s).map(([i, r]) => i + byteLength(r));
const firstSep = (s: string, sep: readonly number[]): number => runes(s).find(([, r]) => sep.includes(r))?.[0] ?? -1;
const lastSep = (s: string, sep: readonly number[]): number => runes(s).reverse().find(([, r]) => sep.includes(r))?.[0] ?? -1;
const make = (kind: Kind, len = -1, rest: Omit<Partial<Glob>, 'kind' | 'len'> = {}): Glob => ({ kind, len, ...rest });
const text = (value: string): Glob => make('text', count(value), { text: value });

function matchAll(s: string, ms: Glob[]): boolean {
  let index = 0;
  for (const m of ms) {
    let runeCount = 0; let bytes = 0;
    for (const [, r] of runes(s.slice(index))) {
      runeCount++; bytes += byteLength(r);
      if (runeCount === m.len) break;
    }
    if (runeCount < m.len || !matches(m, s.slice(index, index + bytes))) return false;
    index += bytes;
  }
  return true;
}

function matches(m: Glob, s: string): boolean {
  const children = m.children ?? [];
  switch (m.kind) {
    case 'text': return m.text === s;
    case 'nothing': return s.length === 0;
    case 'super': return true;
    case 'any': return firstSep(s, m.sep!) === -1;
    case 'single': case 'list': case 'range': {
      const [r, width] = decode(s);
      if (s.length > width) return false;
      if (m.kind === 'single') return !m.sep!.includes(r);
      return (m.kind === 'list' ? m.list!.includes(r) : r >= m.lo! && r <= m.hi!) !== m.not;
    }
    case 'min': return count(s) >= m.limit! && s.length > 0;
    case 'max': return count(s) <= m.limit!;
    case 'contains': return s.includes(m.text!) !== m.not;
    case 'prefix': return s.startsWith(m.text!);
    case 'suffix': return s.endsWith(m.text!);
    case 'prefixSuffix': return s.startsWith(m.text!) && s.endsWith(m.suffix!);
    case 'prefixAny': return s.startsWith(m.text!) && firstSep(s.slice(m.text!.length), m.sep!) === -1;
    case 'suffixAny': return s.endsWith(m.text!) && firstSep(s.slice(0, s.length - m.text!.length), m.sep!) === -1;
    case 'anyof': return children.some(c => matches(c, s));
    case 'every': return children.every(c => matches(c, s));
    case 'row': return count(s) === m.len && matchAll(s, children);
    case 'btree': {
      if (m.len !== -1 && m.len > s.length) return false;
      let offset = Math.max(m.left?.len ?? 0, 0);
      const rightLen = m.right?.len ?? 0;
      const limit = rightLen >= 0 ? s.length - rightLen : s.length;
      while (offset < limit) {
        const [i, segments] = find(m.value!, s.slice(offset, limit));
        if (i === -1) return false;
        const left = s.slice(0, offset + i);
        if (m.left ? matches(m.left, left) : left === '') {
          for (let j = segments.length - 1; j >= 0; j--) {
            const right = s.slice(Math.min(s.length, offset + i + segments[j]!));
            if (m.right ? matches(m.right, right) : right === '') return true;
          }
        }
        offset += i + decode(s, offset + i)[1];
      }
      return false;
    }
    default: throw new Error('unexpected matcher kind');
  }
}

function find(m: Glob, s: string): Index {
  const children = m.children ?? [];
  switch (m.kind) {
    case 'text': { const i = s.indexOf(m.text!); return i < 0 ? none() : [i, [m.text!.length]]; }
    case 'nothing': return [0, [0]];
    case 'super': return [0, ends(s)];
    case 'any': { const i = firstSep(s, m.sep!); return [0, ends(i === -1 ? s : s.slice(0, i))]; }
    case 'single': case 'list': case 'range': {
      for (const [i, r] of runes(s)) {
        const yes = m.kind === 'single' ? !m.sep!.includes(r) : (m.kind === 'list' ? m.list!.includes(r) : r >= m.lo! && r <= m.hi!) !== m.not;
        if (yes) return [i, [byteLength(r)]];
      }
      return none();
    }
    case 'min': {
      if (s.length - m.limit! + 1 <= 0) return none();
      const segments = runeEnds(s).slice(m.limit! - 1);
      return segments.length ? [0, segments] : none();
    }
    case 'max': return [0, [0, ...runeEnds(s).slice(0, m.limit!)]];
    case 'contains': {
      const i = s.indexOf(m.text!); let offset = 0;
      if (!m.not) {
        if (i === -1) return none();
        offset = i + m.text!.length;
        if (s.length <= offset) return [0, [offset]];
        s = s.slice(offset);
      } else if (i !== -1) s = s.slice(0, i);
      return [0, ends(s).map(n => offset + n)];
    }
    case 'prefix': case 'prefixAny': {
      const i = s.indexOf(m.text!);
      if (i === -1) return none();
      const length = m.text!.length; let sub = s.slice(i + length);
      if (m.kind === 'prefixAny') { const sep = firstSep(sub, m.sep!); if (sep !== -1) sub = sub.slice(0, sep); }
      return [i, [length, ...runeEnds(sub).map(n => n + length)]];
    }
    case 'suffix': { const i = s.indexOf(m.text!); return i === -1 ? none() : [0, [i + m.text!.length]]; }
    case 'suffixAny': {
      const i = s.indexOf(m.text!); if (i === -1) return none();
      const start = lastSep(s.slice(0, i), m.sep!) + 1;
      return [start, [i + m.text!.length - start]];
    }
    case 'prefixSuffix': {
      const i = s.indexOf(m.text!); if (i === -1) return none();
      const size = m.suffix!.length;
      if (!size) return [i, [s.length - i]];
      if (s.length - i <= 0) return none();
      let sub = s.slice(i); const segments: number[] = [];
      while (true) { const suffix = sub.lastIndexOf(m.suffix!); if (suffix === -1) break; segments.push(suffix + size); sub = sub.slice(0, suffix); }
      return segments.length ? [i, segments.reverse()] : none();
    }
    case 'row': {
      for (const [i] of runes(s)) {
        if (s.length - i < m.len) break;
        if (matchAll(s.slice(i), children)) return [i, [m.len]];
      }
      return none();
    }
    case 'anyof': {
      let index = -1; let segments: number[] = [];
      for (const child of children) {
        const [i, ns] = find(child, s);
        if (i === -1) continue;
        if (index === -1 || i < index) { index = i; segments = ns; }
        else if (i === index) segments = [...new Set([...segments, ...ns])].sort((a,b) => a-b);
      }
      return [index, segments];
    }
    case 'every': {
      let index = 0; let offset = 0; let sub = s; let current: number[] = [];
      for (let i = 0; i < children.length; i++) {
        const [idx, segments] = find(children[i]!, sub);
        if (idx === -1) return none();
        if (!i) current = segments;
        else {
          const delta = index - (idx + offset);
          current = segments.filter(n => current.some(ex => ex + delta === n));
          if (!current.length) return none();
        }
        index = idx + offset; sub = s.slice(index); offset += idx;
      }
      return [index, current];
    }
    case 'btree': return none(); // Pinned native BTree.Index is deliberately unimplemented.
    default: throw new Error('unexpected index matcher kind');
  }
}

function optimizeOne(m: Glob, l = m.left, r = m.right): Glob {
  if (m.kind === 'anyof' && m.children!.length === 1) return m.children![0]!;
  if (m.kind === 'list' && !m.not && m.list!.length === 1) return text(encode(String.fromCodePoint(m.list![0]!)));
  if (m.kind !== 'btree') return m;
  m = { ...m, left: l, right: r };
  if (m.value!.kind !== 'text') return m;
  const value = m.value!.text!;
  if (!l && !r) return text(value);
  if (l?.kind === 'super' && r?.kind === 'super') return make('contains', -1, { text: value, not: false });
  if (l?.kind === 'super' && !r) return make('suffix', -1, { text: value });
  if (r?.kind === 'super' && !l) return make('prefix', -1, { text: value });
  if (!l && r?.kind === 'suffix') return make('prefixSuffix', -1, { text: value, suffix: r.text });
  if (!r && l?.kind === 'prefix') return make('prefixSuffix', -1, { text: l.text, suffix: value });
  if (!r && l?.kind === 'any') return make('suffixAny', -1, { text: value, sep: l.sep });
  if (!l && r?.kind === 'any') return make('prefixAny', -1, { text: value, sep: r.sep });
  return m;
}

const optimized = new WeakMap<Glob,Glob>();
function optimize(root: Glob): Glob {
  const pending: [Glob,boolean][] = [[root,false]];
  while (pending.length) {
    const [m,ready] = pending.pop()!;
    if (optimized.has(m)) continue;
    if (m.kind !== 'btree' || ready) {
      const result=optimizeOne(m,m.left?optimized.get(m.left):undefined,m.right?optimized.get(m.right):undefined);
      optimized.set(m,result); optimized.set(result,result);
    } else {
      pending.push([m,true]);
      if (m.left) pending.push([m.left,false]);
      if (m.right) pending.push([m.right,false]);
    }
  }
  return optimized.get(root)!;
}

function primitiveSeparatorKey(m: Glob | undefined): string | undefined {
  return m?.kind === 'super' ? '' : m?.kind === 'any' || m?.kind === 'single' ? m.sep!.join(',') : m?.kind === 'list' && m.not ? m.list!.join(',') : undefined;
}

function glue(ms: Glob[]): Glob | undefined {
  if (ms.length <= 1) return undefined;
  let any = false; let superStar = false; let single = false; let minimum = 0; let separator: number[] | undefined;
  let everyPossible = true;
  for (const m of ms) {
    let sep: number[];
    if (m.kind === 'super') { sep = []; superStar = true; }
    else if (m.kind === 'any') { sep = m.sep!; any = true; }
    else if (m.kind === 'single') { sep = m.sep!; single = true; minimum++; }
    else if (m.kind === 'list' && m.not) { sep = m.list!; single = true; minimum++; }
    else { everyPossible = false; break; }
    if (!separator) separator = sep;
    if (JSON.stringify(sep) !== JSON.stringify(separator)) { everyPossible = false; break; }
  }
  if (everyPossible) {
    if (superStar && !any && !single) return make('super');
    if (any && !superStar && !single) return make('any', -1, { sep: separator! });
    if ((any || superStar) && minimum > 0 && !separator!.length) return make('min', -1, { limit: minimum });
    const children: Glob[] = [];
    if (minimum > 0) {
      children.push(make('min', -1, { limit: minimum }));
      if (!any && !superStar) children.push(make('max', -1, { limit: minimum }));
    }
    if (separator!.length) children.push(make('contains', -1, { text: encode(String.fromCodePoint(...separator!)), not: true }));
    // Native EveryOf.Len returns -1 for a nonempty list.
    return make('every', children.length ? -1 : 0, { children });
  }
  if (ms.every(m => m.len !== -1)) return make('row', ms.reduce((n,m) => n+m.len, 0), { children: ms });
  return undefined;
}

function minimize(ms: Glob[]): Glob[] {
  // Maximal fixed rows and equal-separator primitive runs contain every
  // gluable subgroup. Proper subgroups cannot beat their maximal candidate.
  const full = glue(ms); if (full) return [full];
  if (ms.length < 2) return ms;
  interface Group { start: number; end: number; len: number; kind: 1 | 2 }
  const n = ms.length;
  const rows: (Group | undefined)[] = new Array(n);
  const primitives: (Group | undefined)[] = new Array(n);
  const keys = ms.map(primitiveSeparatorKey);
  const keyEnds = new Uint32Array(n);
  const lengths = new Float64Array(n+1);
  for (let i=0;i<n;i++) lengths[i+1]=lengths[i]!+ms[i]!.len;
  for (let i=n-1;i>=0;i--) keyEnds[i]=keys[i] !== undefined && keys[i]===keys[i+1] ? keyEnds[i+1]! : i+1;
  const entries = (kind: 1 | 2): (Group | undefined)[] => kind===1 ? rows : primitives;
  const add = (kind: 1 | 2, start: number, end: number): void => {
    if (end-start<2) return;
    const len=kind===2 || (keys[start] !== undefined && keyEnds[start]! >= end) ? -1 : lengths[end]!-lengths[start]!;
    entries(kind)[start]={start,end,len,kind};
  };
  let rowStart=-1; let primitiveStart=-1; let previousKey: string | undefined;
  for (let i=0;i<=n;i++) {
    if (ms[i]?.len === undefined || ms[i]!.len===-1) { if(rowStart!==-1) add(1,rowStart,i); rowStart=-1; }
    else if(rowStart===-1) rowStart=i;
    const key=keys[i];
    if(key===undefined || key!==previousKey) { if(primitiveStart!==-1) add(2,primitiveStart,i); primitiveStart=key===undefined?-1:i; }
    previousKey=key;
  }

  // A contained primitive candidate follows its enclosing row in native
  // order and cannot improve either count or length. A row contained in a
  // primitive run has the same variable glue length and a smaller count.
  let containingRow: Group | undefined;
  for(let i=0;i<n;i++) { containingRow=rows[i]??containingRow; if(primitives[i] && containingRow && containingRow.end>=primitives[i]!.end) primitives[i]=undefined; }
  let containingPrimitive: Group | undefined;
  for(let i=0;i<n;i++) { containingPrimitive=primitives[i]??containingPrimitive; if(rows[i] && containingPrimitive && containingPrimitive.end>=rows[i]!.end) rows[i]=undefined; }

  const replacements=new Map<number,{end:number;value:Glob}>();
  const collapse = (g: Group): void => {
    replacements.set(g.start,{end:g.end,value:glue(ms.slice(g.start,g.end))!});
    entries(g.kind)[g.start]=undefined;
  };
  const assemble = (): Glob[] => {
    const result: Glob[]=[];
    for(let i=0;i<n;) { const replacement=replacements.get(i); if(replacement) { result.push(replacement.value); i=replacement.end; } else result.push(ms[i++]!); }
    return result;
  };
  const groups: Group[]=[];
  for(let i=0;i<n;i++) groups.push(...[rows[i],primitives[i]].filter((g): g is Group => g!==undefined).sort((a,b)=>b.end-a.end));
  let firstConflict=groups.length; let lastConflict=-1; let widest=-1;
  for(let i=0;i<groups.length;i++) {
    if(widest!==-1 && groups[widest]!.end>groups[i]!.start) { firstConflict=Math.min(firstConflict,widest); lastConflict=i; }
    if(widest===-1 || groups[i]!.end>groups[widest]!.end) widest=i;
  }
  if(lastConflict===-1) { for(const g of groups) collapse(g); return assemble(); }
  // An independent suffix can only defer the winner from the preceding
  // intervals; it cannot change which preceding interval wins. Its collapses
  // commute, so perform them together. An independent prefix can also batch
  // when every possible prefix winner prevents every later replacement.
  for(let i=lastConflict+1;i<groups.length;i++) collapse(groups[i]!);
  let minSize=Infinity; let minFixedLen=Infinity; let maxSize=0; let maxFixedLen=-1;
  for(let i=0;i<firstConflict;i++) { const g=groups[i]!; minSize=Math.min(minSize,g.end-g.start); if(g.len>=0) minFixedLen=Math.min(minFixedLen,g.len); }
  for(let i=firstConflict;i<=lastConflict;i++) { const g=groups[i]!; maxSize=Math.max(maxSize,g.end-g.start); maxFixedLen=Math.max(maxFixedLen,g.len); }
  if(minSize>=maxSize && minFixedLen>=maxFixedLen) for(let i=0;i<firstConflict;i++) collapse(groups[i]!);

  // The native replacement predicate is not a total ordering. This index
  // skips only intervals where no candidate can replace the current choice;
  // qualifying candidates still execute in exact native left/right order.
  let width=1; while(width<n) width*=2;
  const masks=new Uint8Array(width*2);
  const sizes=new Uint32Array(width*2);
  const lens=new Float64Array(width*2).fill(-1);
  const leaf = (i: number): void => {
    const row=rows[i]; const primitive=primitives[i]; const slot=width+i;
    masks[slot]=(row?1:0)|(primitive?2:0);
    sizes[slot]=Math.max(row?row.end-row.start:0,primitive?primitive.end-primitive.start:0);
    lens[slot]=Math.max(row?.len??-1,primitive?.len??-1);
  };
  const branch = (i: number): void => { masks[i]=masks[i*2]!|masks[i*2+1]!; sizes[i]=Math.max(sizes[i*2]!,sizes[i*2+1]!); lens[i]=Math.max(lens[i*2]!,lens[i*2+1]!); };
  for(let i=0;i<n;i++) leaf(i);
  for(let i=width-1;i>0;i--) branch(i);
  const refresh = (i: number): void => { leaf(i); for(let parent=(width+i)>>1;parent>0;parent>>=1) branch(parent); };
  const first = (from: number, to=n, mask=3, size=0, len=-1): number => {
    const search = (node: number, left: number, right: number): number => {
      if(right<=from || left>=to || !(masks[node]!&mask) || !(sizes[node]!>size || (len>=0 && lens[node]!>len))) return -1;
      if(right-left===1) return left;
      const middle=(left+right)>>1;
      const found=search(node*2,left,middle);
      return found===-1 ? search(node*2+1,middle,right) : found;
    };
    return search(1,0,width);
  };
  const last = (to: number, mask: number): number => {
    const search = (node: number, left: number, right: number): number => {
      if(left>=to || !(masks[node]!&mask)) return -1;
      if(right-left===1) return left;
      const middle=(left+right)>>1;
      const found=search(node*2+1,middle,right);
      return found===-1 ? search(node*2,left,middle) : found;
    };
    return search(1,0,width);
  };
  const choose = (): Group | undefined => {
    let selected: Group | undefined;
    for(let i=first(0);i!==-1;i=first(i+1,n,3,selected!.end-selected!.start,selected!.len)) {
      const candidates=[rows[i],primitives[i]].filter((g): g is Group => g!==undefined).sort((a,b)=>b.end-a.end);
      for(const g of candidates) if(!selected || (selected.len>=0 && g.len>=0 && g.len>selected.len) || g.end-g.start>selected.end-selected.start) selected=g;
    }
    return selected;
  };
  for(let selected=choose();selected;selected=choose()) {
    const {start,end}=selected;
    replacements.set(start,{end,value:glue(ms.slice(start,end))!});
    const overlapping: Group[]=[];
    for(const kind of [1,2] as const) {
      const previous=last(start+1,kind);
      if(previous!==-1 && entries(kind)[previous]!.end>start) overlapping.push(entries(kind)[previous]!);
      for(let i=first(start+1,end,kind);i!==-1;i=first(i+1,end,kind)) overlapping.push(entries(kind)[i]!);
    }
    // A row is nonprimitive; Every/Min are variable barriers; a pure Any or
    // Super retains its old separator key. Thus glue never joins neighboring
    // maximal runs. Overlaps only disappear or split into untouched original
    // intervals, and each source token is sliced/glued at most once.
    for(const g of overlapping) { entries(g.kind)[g.start]=undefined; refresh(g.start); }
    for(const g of overlapping) {
      add(g.kind,g.start,start); add(g.kind,end,g.end);
      refresh(g.start); if(end<n) refresh(end);
    }
  }
  return assemble();
}

function compileSequence(ms: Glob[]): Glob {
  if (ms.length === 1) return ms[0]!;
  const glued = glue(ms); if (glued) return glued;
  // Cartesian tree of the native pivot priority: rightmost longest fixed
  // matcher, otherwise first variable matcher. Build and optimize iteratively
  // so a valid alternating mask cannot exhaust the JavaScript call stack.
  const n=ms.length;
  const lefts=new Int32Array(n).fill(-1); const rights=new Int32Array(n).fill(-1);
  const starts=new Uint32Array(n); const ends=new Uint32Array(n);
  const variables=new Uint32Array(n+1); const everyEnd=new Uint32Array(n);
  const keys=ms.map(primitiveSeparatorKey);
  const stack: number[]=[];
  const higher=(a:number,b:number):boolean => ms[a]!.len !== ms[b]!.len ? ms[a]!.len > ms[b]!.len : ms[a]!.len >= 0 ? a>b : a<b;
  for (let i=0;i<n;i++) {
    variables[i+1]=variables[i]!+(ms[i]!.len===-1?1:0);
    let last=-1;
    while(stack.length && higher(i,stack[stack.length-1]!)) last=stack.pop()!;
    lefts[i]=last;
    if(stack.length) rights[stack[stack.length-1]!]=i;
    stack.push(i);
  }
  for(let i=n-1;i>=0;i--) everyEnd[i]=keys[i] !== undefined && keys[i]===keys[i+1] ? everyEnd[i+1]! : i+1;
  const root=stack[0]!;
  const order: [number,boolean][]=[[root,false]];
  while(order.length) {
    const [i,ready]=order.pop()!;
    if(ready) { starts[i]=lefts[i]===-1?i:starts[lefts[i]!]!; ends[i]=rights[i]===-1?i+1:ends[rights[i]!]!; }
    else { order.push([i,true]); if(lefts[i]!==-1) order.push([lefts[i]!,false]); if(rights[i]!==-1) order.push([rights[i]!,false]); }
  }
  const results=new Map<number,Glob>();
  order.push([root,false]);
  while(order.length) {
    const [i,ready]=order.pop()!;
    const start=starts[i]!; const end=ends[i]!;
    if(end-start===1) { results.set(i,ms[i]!); continue; }
    if (variables[end]! === variables[start]! || (keys[start] !== undefined && everyEnd[start]! >= end)) {
      results.set(i,glue(ms.slice(start,end))!); continue;
    }
    if(!ready) { order.push([i,true]); if(lefts[i]!==-1) order.push([lefts[i]!,false]); if(rights[i]!==-1) order.push([rights[i]!,false]); continue; }
    const left=results.get(lefts[i]!); const right=results.get(rights[i]!); const value=ms[i]!;
    const lens=[value.len,left?.len??0,right?.len??0];
    results.set(i,make('btree',lens.includes(-1)?-1:lens.reduce((a,b)=>a+b,0),{value,left,right}));
  }
  return results.get(root)!;
}

function simplifyAlternatives(node: Node): Node | undefined {
  const choices = node.children!;
  if (choices.length <= 1 || choices.some(c => c.kind !== 'pattern')) return undefined;
  const least = choices.reduce((a,b) => a.children!.length <= b.children!.length ? a : b).children!;
  const same = (a: Node, b: Node): boolean => {
    const pending: [Node, Node][] = [[a,b]];
    while (pending.length) {
      const [x,y] = pending.pop()!;
      if (x.kind !== y.kind || x.text !== y.text || x.lo !== y.lo || x.hi !== y.hi || x.not !== y.not || (x.children?.length ?? 0) !== (y.children?.length ?? 0)) return false;
      for (let i = 0; i < (x.children?.length ?? 0); i++) pending.push([x.children![i]!,y.children![i]!]);
    }
    return true;
  };
  const commonLeft: Node[] = []; const commonRight: Node[] = [];
  let breakLeft = false; let breakRight = false; let total = 0;
  // Match native commonChildren's alternating prefix/suffix ownership exactly.
  for (let i = 0, j = least.length-1; total < least.length && j >= 0 && !(breakLeft && breakRight); i++, j--) {
    for (const choice of choices) {
      if (choice.children === least) continue;
      breakLeft ||= !same(least[i]!,choice.children![i]!);
      breakRight ||= !breakLeft && j <= i;
      breakRight ||= !same(least[j]!,choice.children![j+choice.children!.length-least.length]!);
    }
    if (!breakLeft) { total++; commonLeft.push(least[i]!); }
    if (!breakRight) { total++; commonRight.unshift(least[j]!); }
  }
  const left = commonLeft.length; const right = commonRight.length;
  if (!left && !right) return undefined;
  const common: Node[] = [];
  if (left) common.push({ kind: 'pattern', children: commonLeft });
  const alternatives: Node[] = [];
  for (const c of choices) {
    const middle = c.children!.slice(left,c.children!.length-right);
    const next: Node = middle.length ? { kind:'pattern', children:middle } : { kind:'nothing' };
    if (!alternatives.some(a => same(a,next))) alternatives.push(next);
  }
  if (alternatives.length === 1 && alternatives[0]!.kind !== 'nothing') common.push(alternatives[0]!);
  else if (alternatives.length > 1) common.push({ kind:'anyof', children:alternatives });
  if (right) common.push({ kind:'pattern', children:commonRight });
  return { kind:'pattern', children:common };
}

function compileNode(node: Node, get: (node: Node) => Glob): Glob {
  switch (node.kind) {
    case 'pattern': return node.children!.length ? optimize(compileSequence(minimize(node.children!.map(c => optimize(get(c)))))) : make('nothing', 0);
    case 'anyof': {
      const children = node.children!.map(c => optimize(get(c)));
      let len = -1;
      for (const m of children) { if (len === -1) len = m.len; else if (m.len === -1 || len !== m.len) { len = -1; break; } }
      return optimize(make('anyof', len, { children }));
    }
    case 'text': return text(encode(node.text!));
    case 'nothing': return make('nothing', 0);
    case 'any': return make('any', -1, { sep: [47] });
    case 'super': return make('super');
    case 'single': return make('single', 1, { sep: [47] });
    case 'list': return make('list', 1, { list: Array.from(node.text!,r => r.codePointAt(0)!), not: node.not });
    case 'range': return make('range', 1, { lo:node.lo, hi:node.hi, not:node.not });
    default: throw new Error('unexpected AST kind');
  }
}

function compile(root: Node): Glob {
  const compiled = new WeakMap<Node, Glob>();
  const simplified = new WeakMap<Node, Node>();
  const pending: [Node, boolean][] = [[root,false]];
  while (pending.length) {
    const [node, ready] = pending.pop()!;
    if (compiled.has(node)) continue;
    if (ready) {
      const replacement = simplified.get(node);
      compiled.set(node,replacement ? compiled.get(replacement)! : compileNode(node,n => compiled.get(n)!));
      continue;
    }
    pending.push([node,true]);
    const smaller = node.kind === 'anyof' ? simplifyAlternatives(node) : undefined;
    if (smaller) { simplified.set(node,smaller); pending.push([smaller,false]); }
    else for (const child of node.children ?? []) pending.push([child,false]);
  }
  return compiled.get(root)!;
}

function parse(pattern: string): Node {
  const source = Array.from(pattern.split('\0',1)[0]!);
  if (source.some(r => r === '\ufffd' || (r.codePointAt(0)! >= 0xd800 && r.codePointAt(0)! <= 0xdfff))) throw new Error('could not read rune');
  const root: Node = { kind:'pattern', children:[] };
  let current = root; const stack: { parent: Node; choices: Node }[] = [];
  let pos = 0;
  while (pos < source.length) {
    const r = source[pos++]!;
    if (r === '{') {
      const choices: Node = { kind:'anyof', children:[] };
      current.children!.push(choices); stack.push({ parent:current, choices });
      current = { kind:'pattern', children:[] }; choices.children!.push(current);
    } else if (stack.length && r === ',') {
      current = { kind:'pattern', children:[] }; stack[stack.length-1]!.choices.children!.push(current);
    } else if (stack.length && r === '}') {
      current = stack.pop()!.parent;
    } else if (r === '*') {
      const superStar = source[pos] === '*'; if (superStar) pos++;
      current.children!.push({ kind: superStar ? 'super' : 'any' });
    } else if (r === '?') current.children!.push({ kind:'single' });
    else if (r === '[') {
      let not = false; if (source[pos] === '!') { not = true; pos++; }
      const first = source[pos]; if (first === undefined) throw new Error('unexpected end of input');
      if (source[pos+1] === '-') {
        pos += 2; const high = source[pos++]; if (high === undefined) throw new Error('unexpected end of input');
        if (source[pos++] !== ']') throw new Error('expected close range character');
        const lo = first.codePointAt(0)!; const hi = high.codePointAt(0)!;
        if (hi < lo) throw new Error(`hi character '${high}' should be greater than lo '${first}'`);
        current.children!.push({ kind:'range', lo, hi, not });
      } else {
        let chars = ''; let closed = false;
        while (pos < source.length) {
          let c = source[pos++]!;
          if (c === ']') { closed = true; break; }
          if (c === '\\') { if (pos === source.length) break; c = source[pos++]!; }
          chars += c;
        }
        if (!closed) throw new Error('unexpected end of input');
        if (!chars) throw new Error('could not parse range');
        current.children!.push({ kind:'list', text:chars, not });
      }
    } else {
      pos--; let literal = '';
      while (pos < source.length) {
        let c = source[pos]!;
        if ('?*[{'.includes(c) || (stack.length && ',}'.includes(c))) break;
        pos++;
        if (c === '\\') { if (pos === source.length) break; c = source[pos++]!; }
        literal += c;
      }
      if (literal) current.children!.push({ kind:'text', text:literal });
    }
  }
  return root;
}

export function compileGlob(pattern: string): (path: string) => boolean {
  const glob = compile(parse(pattern));
  return path => matches(glob, encode(path));
}
