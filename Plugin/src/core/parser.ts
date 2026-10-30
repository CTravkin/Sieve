/*! @license Syncthing Authors, parser/expansion from Syncthing v2.1.6, MPL-2.0; see THIRD-PARTY-NOTICES.md */
// This Source Code Form is subject to the Mozilla Public License 2.0.
// https://mozilla.org/MPL/2.0/ ; see THIRD-PARTY-NOTICES.md.
import { compileGlob } from './glob.ts';
import { defaultCaseFold, dirname, foldCase, joinPath, nativeNormalize, relativePath, scanLines, sha256, toSlash, trimSpace } from './normalize.ts';
import type { CompileContext, CompiledPattern, Diagnostic, IncludeDependency } from './types.ts';

export class RuleError extends Error {
  constructor(readonly diagnostic: Diagnostic) { super(diagnostic.reason); }
}

function canSkip(pattern: string, ignored: boolean): boolean {
  if (ignored) return true;
  if (!pattern.startsWith('/')) return false;
  let p = pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern;
  if (p === '') return true;
  if (p.slice(1).includes('/')) return false;
  p = p.endsWith('**') ? p.slice(0, -2) : p;
  return !p.includes('**');
}

function parseLine(text: string, context: CompileContext): CompiledPattern[] {
  let line = nativeNormalize(text, context.platform);
  let ignored = true; let deletable = false; let caseFolded = defaultCaseFold(context.platform);
  const seen = new Set<string>();
  while (true) {
    const prefix = ['!', '(?i)', '(?d)'].find(p => !seen.has(p) && line.startsWith(p));
    if (!prefix) break;
    seen.add(prefix); line = line.slice(prefix.length);
    if (prefix === '!') ignored = false;
    if (prefix === '(?i)') caseFolded = true;
    if (prefix === '(?d)') deletable = true;
  }
  if (!line) throw new Error('missing pattern');
  if (caseFolded) line = foldCase(line);
  const patterns = line.startsWith('/') ? [line] : line.startsWith('**/') ? (line.length === 3 ? [line] : [line, line.slice(3)]) : [line, '**/' + line];
  return patterns.map(pattern => Object.freeze({
    pattern, ignored, deletable, caseFolded, allowsSkipping: canSkip(pattern, ignored),
    test: compileGlob(pattern.startsWith('/') ? pattern.slice(1) : pattern),
  }));
}

export function patternString(p: CompiledPattern): string {
  return `${p.ignored && p.deletable ? '(?d)' : ''}${p.caseFolded ? '(?i)' : ''}${p.ignored ? '' : '!'}${p.pattern}`;
}

export async function parseRules(text: string, context: CompileContext): Promise<{ patterns: readonly CompiledPattern[]; dependencies: readonly IncludeDependency[] }> {
  const seenLines = new Set<string>(); const seenFiles = new Set<string>();
  const patterns: CompiledPattern[] = []; const dependencies: IncludeDependency[] = [];
  const initialRoot = context.root === undefined ? (context.platform === 'windows' ? 'C:/__sieve_virtual_root__' : '/__sieve_virtual_root__') : joinPath(context.platform, context.root);
  let scopeCount = 0;
  async function parse(contents: string | Uint8Array, source: string, includeSource: string, scopeRoot: string, scope: number,isRoot:boolean): Promise<void> {
    const fail = (source: string, line: number, code: Diagnostic['code'], reason: string): never => { throw new RuleError(Object.freeze({ source, line, code, reason, isRoot })); };
    const lines = scanLines(contents);
    const oversized = lines.findIndex(line => line.bytes >= 65536);
    if (oversized !== -1) fail(source, oversized + 1, 'line-too-long', 'bufio.Scanner: token too long');
    let escape = context.platform === 'windows' ? '|' : '\\';
    let escapeSeen = false; let ownPatterns = false;
    for (let index = 0; index < lines.length; index++) {
      const lineNumber = index + 1;
      const raw = lines[index];
      let line = trimSpace(raw.text);
      if (line.startsWith('#escape')) {
        if (escapeSeen) fail(source, lineNumber, 'escape', 'mutiple #escape= lines found in ignore file');
        if (ownPatterns) fail(source, lineNumber, 'escape', '#escape= line found after patterns in ignore file');
        escapeSeen = true;
        const value = trimSpace(line.slice(7));
        const character = value.startsWith('=') ? trimSpace(value.slice(1)) : '';
        if (Array.from(character).length !== 1) fail(source, lineNumber, 'escape', `failed to parse #escape= line in ignore file: ${line}`);
        const rune = character.codePointAt(0)!;
        escape = rune >= 0xd800 && rune <= 0xdfff ? '\ufffd' : character;
        continue;
      }
      if (seenLines.has(line)) continue;
      seenLines.add(line);
      if (!line || line.startsWith('//')) continue;
      if (escape !== '\\') {
        line = toSlash(line, context.platform).split(escape).join('\\').replace(/\\\\/g, '\\' + escape);
      }
      if (line.startsWith('#include')) {
        const space = line.indexOf(' ');
        const name = space < 0 ? '' : trimSpace(line.slice(space + 1));
        if (!name) fail(source, lineNumber, 'include-syntax', 'failed to parse #include line: no file?');
        const relative = joinPath(context.platform, dirname(includeSource), name);
        const joined = joinPath(context.platform, scopeRoot, relative);
        const path = context.root === undefined ? joinPath(context.platform, '.', relativePath(initialRoot, joined)) : joined;
        // Native BasicFilesystem rebases each escaping include to a new filesystem.
        // Its ChangeDetector keys on filesystem object + lexical name, not physical inode.
        const outside = !joined.startsWith(scopeRoot.replace(/\/$/, '') + '/');
        const childScope = outside ? ++scopeCount : scope;
        const childRoot = outside ? dirname(joined) : scopeRoot;
        const childName = outside ? joined.slice(joined.lastIndexOf('/')+1) : relative;
        const identity = `${childScope}:${childName}`;
        if (seenFiles.has(identity)) fail(source, lineNumber, 'multiple-include', `failed to load include file ${relative}: multiple include`);
        if (!context.readInclude) fail(source, lineNumber, 'include-read', `failed to load include file ${relative}: include reader unavailable`);
        let content: string | Uint8Array;
        try {
          content = await context.readInclude!(path);
          if (typeof content !== 'string' && !(content instanceof Uint8Array)) throw new Error('include reader returned no contents');
        } catch (error) {
          fail(source, lineNumber, 'include-read', `failed to load include file ${relative}: ${error instanceof Error ? error.message : String(error)}`);
        }
        seenFiles.add(identity);
        dependencies.push(Object.freeze({ path, revision: sha256(content!) }));
        await parse(content!, path, childName, childRoot, childScope,false);
      } else {
        try {
          if (line.endsWith('/**')) patterns.push(...parseLine(line, context));
          else if (line.endsWith('/')) patterns.push(...parseLine(line + '**', context));
          else { patterns.push(...parseLine(line, context)); patterns.push(...parseLine(line + '/**', context)); }
        } catch (error) {
          fail(source, lineNumber, 'pattern', `invalid pattern ${JSON.stringify(line)} in ignore file: ${error instanceof Error ? error.message : String(error)}`);
        }
        ownPatterns = true;
      }
    }
  }
  await parse(text, '.stignore', '.stignore', initialRoot, 0,true);
  return { patterns: Object.freeze(patterns), dependencies: Object.freeze(dependencies) };
}
