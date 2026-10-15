/*! @license Syncthing Authors, matching/flags from Syncthing v2.1.6, MPL-2.0; see THIRD-PARTY-NOTICES.md */
// This Source Code Form is subject to the Mozilla Public License 2.0.
// https://mozilla.org/MPL/2.0/ ; see THIRD-PARTY-NOTICES.md.
import { foldCase, sha256, toSlash } from './normalize.ts';
import { encodeGlobPath } from './glob.ts';
import { parseRules, patternString, RuleError } from './parser.ts';
import type { CompileContext, CompileResult, MatchResult } from './types.ts';
export type { CompileContext, CompileResult, Diagnostic, IncludeDependency, Matcher, MatchResult, Platform } from './types.ts';

export const upstreamRevision = 'syncthing-v2.1.6:4461a1ce354d3990660966ad70176e00246adb61';
const included: MatchResult = Object.freeze({ ignored: false, deletable: false, caseFolded: false, canSkipDir: false });

export async function compileRules(text: string, context: CompileContext): Promise<CompileResult> {
  context = Object.freeze({ platform: context.platform, root: context.root, readInclude: context.readInclude });
  try {
    const { patterns, dependencies } = await parseRules(text, context);
    const matcher = Object.freeze({
      match(relativePath: string): MatchResult {
        const path = toSlash(relativePath, context.platform);
        // Native IsTemporary uses filepath.Base, which cleans trailing separators.
        const basename = path.replace(/\/+$/, '').split('/').pop() ?? '';
        const temporary = basename.startsWith('.syncthing.') || basename.startsWith('~syncthing~');
        const internal = ['.stfolder', '.stignore', '.stversions'].some(p => path === p || path.startsWith(p + '/'));
        if (temporary || internal) return Object.freeze({ ignored: true, deletable: false, caseFolded: context.platform === 'windows' || context.platform === 'darwin' || context.platform === 'ios', canSkipDir: true });
        if (path === '.') return included;
        let lower: string | undefined; let encoded: string | undefined; let encodedLower: string | undefined; let canSkipDir = true;
        for (const pattern of patterns) {
          if (canSkipDir && !pattern.allowsSkipping) canSkipDir = false;
          if (pattern.caseFolded) {lower ??= foldCase(path);encodedLower ??= encodeGlobPath(lower);}
          else encoded ??= encodeGlobPath(path);
          if (pattern.test(pattern.caseFolded ? lower! : path, pattern.caseFolded ? encodedLower! : encoded!)) {
            return Object.freeze({ ignored: pattern.ignored, deletable: pattern.ignored && pattern.deletable, caseFolded: pattern.caseFolded, canSkipDir: pattern.ignored && canSkipDir });
          }
        }
        return included;
      },
    });
    const hash = sha256(patterns.map(patternString).map(p => p + '\n').join(''));
    return Object.freeze({ ok: true, matcher, dependencies, revision: `${upstreamRevision}:${context.platform}:${hash}`, diagnostics: Object.freeze([]) });
  } catch (error) {
    if (error instanceof RuleError) return Object.freeze({ ok: false, diagnostics: Object.freeze([error.diagnostic]) });
    throw error;
  }
}
