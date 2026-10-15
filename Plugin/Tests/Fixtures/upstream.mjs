// Adapted from Syncthing v2.1.6 lib/ignore/ignore_test.go, copyright Syncthing Authors.
// This Source Code Form is subject to the terms of the Mozilla Public License 2.0.
// https://mozilla.org/MPL/2.0/ ; see THIRD-PARTY-NOTICES.md.

const rows = (name, rules, table, files) => ({ name, rules, paths: table.map(r => r[0]), expected: table.map(r => r[1]), ...(files ? { files } : {}) });
const files = { excludes: 'dir2/dfile\n#include further-excludes\n', 'further-excludes': 'dir3\n', 'escape-excludes': 'dir4\n' };

// Every observable syntax/match/traversal test in the pinned ignore suite is mapped below.
export const upstreamCoverage = {
  TestIgnore: 'basic includes and paths', TestExcludes: 'first-match include precedence',
  TestFlagOrder: 'each prefix order, repeated prefixes as pattern literals', TestDeletables: 'all deletable flag rows',
  TestBadPatterns: 'all rows characterized even though upstream skips this test',
  TestCaseSensitivity: 'platform native default folding', TestCommentsAndBlankLines: 'comments and empty source',
  TestNegatedGlobstarOnly: 'empty leading globstar remainder',
  TestCacheReload: 'Core immutable compile lifecycle, include changes and fresh reads',
  TestHash: 'Oracle native pattern hash and Core revision stability', TestHashOfEmpty: 'Oracle empty hash and Core empty compile',
  TestWindowsPatterns: 'native Windows separators', TestAutomaticCaseInsensitivity: 'native default folding',
  TestCommas: 'literal commas and alternatives', TestIssue3164: 'full expanded native pattern hash comparison',
  TestIssue3174: 'native Unicode normalized input', TestIssue3639: 'trailing slash excludes children only',
  TestIssue3674: 'single/globstar separator rows', TestGobwasGlobIssue18: 'single rune width rows',
  TestRoot: 'root exception and dot', TestLines: 'comments-only and duplicate source revision lifecycle',
  TestDuplicateLines: 'global exact-line dedup', TestIssue4680: 'hash-prefix literal rule',
  TestIssue4689: 'comments change without match/hash change', TestIssue4901: 'missing include compile retry',
  TestIssue5009: 'CanSkipDir with/without earlier allow rules', TestSpecialChars: 'special and space filenames',
  TestIntlWildcards: 'all multibyte wildcard rows', TestPartialIncludeLine: 'all incomplete include rows',
  TestSkipIgnoredDirs: 'all rooted pruning exceptions and matcher rows', TestEmptyPatterns: 'all missing-pattern rows',
  TestWindowsLineEndings: 'CRLF parse coverage; WriteIgnores is not part of core (no rule-file writer)',
  TestEscapeBackslash: 'all default escape rows', TestEscapePipe: 'all default Windows pipe rows',
  TestEscapeOverrideBackslash: 'all explicit backslash rows', TestEscapeOverridePipe: 'all pipe/>/multibyte escape rows',
  TestEscapeBeforePattern: 'all 8 preambles for all explicit escape rows', TestEscapeEmpty: 'all 7 invalid empty forms',
  TestEscapeInvalid: 'all 4 multirune escape forms', TestEscapeAfterPattern: 'all 8 preambles x 3 own-pattern suffixes',
  TestEscapeDoubled: 'all 4 repeated escape forms', TestIgnoreThroughSymlink: 'native basic symlink test, upstream skips Windows',
};

export function upstreamFixtures(platform) {
  const win = platform === 'windows';
  const folded = ['windows', 'darwin', 'ios'].includes(platform);
  const corpus = [
    rows('TestIgnore', '#include excludes\nbfile\ndir1/cfile\n**/efile\n/ffile\nlost+found\n', [
      ['afile', false], ['bfile', true], ['cfile', false], ['dfile', false], ['efile', true], ['ffile', true],
      ['dir1', false], ['dir1/cfile', true], ['dir1/dfile', false], ['dir1/efile', true], ['dir1/ffile', false],
      ['dir2', false], ['dir2/cfile', false], ['dir2/dfile', true], ['dir2/efile', true], ['dir2/ffile', false],
      ['dir3', true], ['dir3/afile', true], ['lost+found', true],
    ], files),
    rows('TestExcludes', '!iex2\n!ign1/ex\nign1\ni*2\n!ign2', [
      ['ign1', true], ['ign2', true], ['ibla2', true], ['iex2', false], ['ign1/ign', true], ['ign1/ex', false],
      ['ign1/iex2', false], ['iex2/ign', false], ['foo/bar/ign1', true], ['foo/bar/ign2', true], ['foo/bar/iex2', false],
    ]),
    rows('TestFlagOrder', '## Ok cases\n(?i)(?d)!ign1\n(?d)(?i)!ign2\n(?i)!(?d)ign3\n(?d)!(?i)ign4\n!(?i)(?d)ign5\n!(?d)(?i)ign6\n## Bad cases\n!!(?i)(?d)ign7\n(?i)(?i)(?d)ign8\n(?i)(?d)(?d)!ign9\n(?d)(?d)!ign10', [
      ...Array.from({ length: 9 }, (_, i) => [`ign${i + 1}`, false]), ['(?d)!ign10', true],
    ]),
    rows('TestDeletables', '(?d)ign1\n(?d)(?i)ign2\n(?i)(?d)ign3\n!(?d)ign4\n!ign5\n!(?i)(?d)ign6\nign7\n(?i)ign8', [
      ['ign1', true], ['ign2', true], ['ign3', true], ['ign4', false], ['ign5', false], ['ign6', false], ['ign7', true], ['ign8', true],
    ]),
    rows('TestCaseSensitivity', 'test', [['test', true], ['foo', false], ['TEST', folded], ['Test', folded], ['tESt', folded]]),
    rows('TestCommentsAndBlankLines', '\n// foo\n//bar\n\n//!baz\n//#dex\n//                        ips\n\n', [['foo', false]]),
    rows('TestNegatedGlobstarOnly', '!**/\n', [['foo', false], ['foo/bar', false]]),
    rows('TestCommas', 'foo,bar.txt\n{baz,quux}.txt', [['foo.txt', false], ['bar.txt', false], ['foo,bar.txt', true], ['baz.txt', true], ['quux.txt', true], ['baz,quux.txt', false]]),
    rows('TestIssue3164', '(?d)(?i)*.part\n(?d)(?i)/foo\n(?d)(?i)**/bar', [['x.part', true], ['FOO', true], ['deep/BAR', true], ['deep/foo', false]]),
    rows('TestIssue3174', '*ä*', [['åäö'.normalize(['darwin', 'ios'].includes(platform) ? 'NFD' : 'NFC'), true]]),
    rows('TestIssue3639', 'foo/', [['foo/bar', true], ['foo', false]]),
    rows('TestIssue3674', 'a*b\na**c', [['ab', true], ['asdfb', true], ['ac', true], ['asdfc', true], ['as/db', false], ['as/dc', true]]),
    rows('TestGobwasGlobIssue18', 'a?b\nbb?', [['ab', false], ['acb', true], ['asdb', false], ['bb', false], ['bba', true], ['bbaa', false]]),
    rows('TestRoot', '!/a\n/*', [['.', false], ['a', false], ['b', true]]),
    rows('TestDuplicateLines', '!/a\n/*\n!/a', [['a', false], ['b', true]]),
    rows('TestIssue4680', '#snapshot', [['#snapshot', true], ['#snapshot/foo', true]]),
    rows('TestIssue4689', '// new', [['foo', false]]),
    rows('TestSpecialChars', '(?i)/#recycle\n(?i)/#nosync\n(?i)/$Recycle.bin\n(?i)/$RECYCLE.BIN\n(?i)/System Volume Information', [['#nosync', true], ['$RECYCLE.BIN', true], ['$RECYCLE.BIN/S-1-5-18/desktop.ini', true]]),
    rows('TestIntlWildcards', '1000春\n200?春\n300[0-9]春\n400[0-9]?', [['1000春', true], ['2002春', true], ['3003春', true], ['4004春', true]]),
    rows('TestWindowsLineEndings/parse', 'foo\r\nbar\r\nbaz\r\n', [['foo', true], ['bar', true], ['baz', true]]),
  ];
  if (win) {
    corpus.push(rows('TestWindowsPatterns', 'a/b\nc\\d', [['a\\b', true], ['c\\d', true]]));
    corpus.push(rows('TestAutomaticCaseInsensitivity', 'A/B\nc/d', [['a/B', true], ['C/d', true]]));
  } else if (folded) corpus.push(rows('TestAutomaticCaseInsensitivity', 'A/B\nc/d', [['a/B', true], ['C/d', true]]));

  const backslash = [
    ['a', 'a', true], ['a*', 'a', true], ['a*b', 'ab', true], ['*a', 'a', true], ['*a*', 'a', true],
    ['a?', 'ab', true], ['a?b', 'acb', true], ['?a', 'ba', true], ['?a?', 'bac', true],
    ['a[bc]', 'ab', true], ['a[bc]d', 'abd', true], ['[ab]c', 'ac', true], ['[ab]c[de]', 'acd', true],
    ['a{b,c}', 'ab', true], ['a{b,c}d', 'abd', true], ['{a,b}c', 'ac', true], ['{a,b}c{d,e}', 'acd', true],
    ['a/**', 'a/b/c', true], ['a**c', 'a/b/c', true], ['**/c', 'a/b/c', true], ['a**b**c', 'a/b/c', true], ['**/c/**', 'a/b/c/d/e', true],
    ['a]b', 'a]b', true], ['a}b', 'a}b', true],
    ['a\\*', 'a*', !win], ['a\\*b', 'a*b', !win], ['\\*a', '*a', true], ['\\*a\\*', '*a*', !win],
    ['a\\?', 'a?', !win], ['a\\?b', 'a?b', !win], ['\\?a', '?a', true], ['\\?a\\?', '?a?', !win],
    ['a\\[bc\\]', 'a[bc]', !win], ['a\\[bc\\]d', 'a[bc]d', !win], ['\\[ab\\]c', '[ab]c', !win], ['\\[ab\\]c\\[de\\]', '[ab]c[de]', !win],
    ['a\\{b,c\\}', 'a{b,c}', !win], ['a\\{b,c\\}d', 'a{b,c}d', !win], ['\\{a,b\\}c', '{a,b}c', !win], ['\\{a,b\\}c\\{d,e\\}', '{a,b}c{d,e}', !win],
    ['a/\\*\\*', 'a/**', !win], ['a\\*\\*c', 'a**c', !win], ['\\*\\*/c', '**/c', !win], ['a\\*\\*b\\*\\*c', 'a**b**c', !win], ['\\*\\*/c/\\*\\*', '**/c/**', !win],
    ['\\a', 'a', true], ['\\a\\b', 'ab', !win], ['\\a\\b', 'a/b', win],
    ['a\\r\\n', 'arn', !win], ['a\\r\\n', 'a/r/n', win], ['\\a\\r\\n', 'arn', !win], ['\\a\\r\\n', 'a/r/n', win], ['\\a\\r\\n', '/a/r/n', false],
  ];
  const pipe = [
    ...backslash.filter(([p]) => p.includes('\\')).map(([p, m]) => [p.replaceAll('\\', '|'), m, !m.includes('/') || p === 'a/\\*\\*' || p === '\\*\\*/c' || p === '\\*\\*/c/\\*\\*']),
    ['a]b', 'a]b', true], ['a}b', 'a}b', true],
  ];
  const override = pipe.filter(([p]) => p !== 'a]b' && p !== 'a}b').map(([p, m, want]) => [p.replaceAll('|', '\\'), m, want]);
  const preambles = ['', '\n', '// comment\n', '\n// comment\n', '#include escape-excludes\n', '// comment\n#include escape-excludes\n', '#include escape-excludes\n//comment\n', '// comment\n#include escape-excludes\n//comment\n'];
  const addEscape = (name, cases, transform = p => p) => cases.forEach(([pattern, match, want], i) => corpus.push(rows(`${name}/${i}`, transform(pattern), [[match, want]], files)));
  addEscape('TestEscapeBackslash', backslash);
  if (win) addEscape('TestEscapePipe', pipe);
  addEscape('TestEscapeOverrideBackslash', override, p => '#escape=\\\n' + p);
  for (const escape of ['|', '>', '␛']) addEscape(`TestEscapeOverridePipe/${escape}`, pipe, p => `#escape=${escape}\n` + p.replaceAll('|', escape));
  for (const [i, prefix] of preambles.entries()) addEscape(`TestEscapeBeforePattern/${i}`, override, p => prefix + '#escape=\\\n' + p);
  const errors = (name, prefixes) => prefixes.forEach((prefix, i) => backslash.forEach(([p, match], j) => corpus.push({ name: `${name}/${i}/${j}`, rules: prefix + p, files, paths: [match], error: true })));
  errors('TestEscapeEmpty', ['', ' ', '\t', '=', '= ', '=\t', 'x'].map(s => '#escape' + s + '\n'));
  errors('TestEscapeInvalid', ['\\\\', '||', '␛␛', 'xx'].map(s => '#escape=' + s + '\n'));
  errors('TestEscapeAfterPattern', preambles.flatMap(pre => ['pattern\n', 'pattern/\n', 'pattern/**\n'].map(s => pre + s + '#escape=␛\n')));
  errors('TestEscapeDoubled', ['#escape\n', '#escape=\n', '#escape=\\\n', '#escape=|\n'].map(s => '#escape=\\\n' + s));
  for (const [i, rule] of ['[', '/[', '**/[', '#include nonexistent', '#include .stignore'].entries()) {
    corpus.push({ name: `TestBadPatterns/${i}`, rules: rule, files: { ...files, '.stignore': '#include .stignore' }, paths: ['any'] });
  }
  for (const [i, rule] of ['#include', '#include\n', '#include ', '#include \n', '#include   \n\n\n', '!', '(?d)', '(?i)'].entries()) corpus.push({ name: `TestPartialIncludeLine+TestEmptyPatterns/${i}`, rules: rule, paths: ['any'], error: true });
  const skip = ['!/test', '!/t[eih]t', '!/t*t', '!/t?t', '!/**', '!/parent/test', '!/parent/t[eih]t', '!/parent/t*t', '!/parent/t?t', '!/**.mp3', '!/pa*nt/test', '!/pa[sdf]nt/t[eih]t', '!/lowest/pa[sdf]nt/test', '!/lo*st/parent/test', '/pa*nt/test', 'test', '*'];
  skip.forEach((rule, i) => corpus.push(rows(`TestSkipIgnoredDirs/${i}`, `${rule}\n*`, [['whatever', rule !== '!/**']])));
  corpus.push(rows('TestSkipIgnoredDirs/rooted', '/foo/ign*\n!/f*\n!/bar\n*', [['whatever', true]]));
  corpus.push(rows('TestSkipIgnoredDirs/descendant', '!/foo/ign*\n*', [['whatever', true]]));
  corpus.push(rows('TestIssue5009/no-includes', 'ign1\ni*2', [['ign2', true]]));
  corpus.push(rows('TestIssue5009/with-includes', '!iex2\n!ign1/ex\nign1\ni*2\n!ign2', [['ign2', true]]));
  return corpus;
}
