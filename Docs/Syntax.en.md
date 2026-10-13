# Filter syntax

[Русский](Syntax.ru.md) · [English](Syntax.en.md)

Compatible with Syncthing filter syntax. Sieve uses Syncthing 2.1.6 as its reference. This is a reference for the planned engine; implementation compatibility has not been verified yet.

## Rule order

Rules are evaluated from top to bottom. The first match determines the result. A regular pattern excludes a path; the `!` prefix includes it. A path with no matching rule is included.

Paths are relative to the vault root. Patterns without a leading `/` match at the root and at any depth; a leading `/` anchors a pattern to the root. `node_modules` matches a file or directory with that name and its contents. `node_modules/` matches its contents, but not the directory itself.

Blank lines are skipped. Leading and trailing whitespace is removed; spaces inside a name are preserved. A comment line starts with `//`. Comments after a pattern and `# comment` lines are not comments.

## Patterns

| Pattern | Meaning |
| --- | --- |
| `*` | Any sequence of characters except a path separator |
| `**` | Any sequence of characters, including separators |
| `?` | One character except a separator |
| `[abc]` | One of the listed characters |
| `[a-z]` | One character in the range |
| `[!a-z]` | One character outside the range |
| `{md,txt,pdf}` | One of the listed alternatives |

These are patterns, not regular expressions. Separators around `**` remain part of a pattern: `a/**/b` does not match `a/b`. Syncthing additionally handles a leading `**/` so the pattern can match at the root.

## Prefixes

`!` includes matching paths. `(?i)` enables case-insensitive matching. Syncthing on Windows and macOS matches case-insensitively by default; explicitly use `(?i)` for portable rules.

`(?d)` allows Syncthing to remove an ignored file when it prevents removal of its parent directory. It does not change the pattern match. Sieve accepts the prefix for compatibility; applying Sieve rules does not delete files.

Prefixes may appear in any order, each at most once: `(?i)!*.md`, `(?d)(?i)*.tmp`. `(?di)` does not combine them.

## Included files

```text
#include filters/common.stignore
```

The included file's rules are inserted at the directive's position. The main list resolves include paths from the vault root; nested includes resolve them from the containing file's directory. Patterns always remain relative to the vault root. The file must be accessible to the application; a missing or repeatedly included file is an error.

Rule files use UTF-8. Each included file has its own escape character.

## Escaping

Windows defaults to `|`; other platforms default to `\`. Explicitly set the escape character to use the same rule text across devices:

```text
#escape=\
```

Specify the directive once per file, before patterns. It must define exactly one character. With `#escape=\`, use `/` for path separators; `\{draft\}.md` matches the literal name `{draft}.md`. In the default Windows mode, the equivalent is `|{draft|}.md`. An escaped escape character represents itself.

## Allowlist

```text
// Technical directories
(?i){node_modules,build,dist}

// Included formats
(?i)!*.{env,md,markdown,base,canvas,pdf,png,jpg,jpeg,webp,svg}
*
```

Complete directory exclusions precede include rules. This lets the scanner skip technical subtrees. Other combinations may require traversing an apparently excluded directory to find an included descendant; such a directory must not be pruned prematurely.

## Sources

- [Syncthing rules](https://docs.syncthing.net/users/ignoring.html)
- [2.1.6 parsing and matching](https://github.com/syncthing/syncthing/blob/v2.1.6/lib/ignore/ignore.go)
- [Native compatibility tests](https://github.com/syncthing/syncthing/blob/v2.1.6/lib/ignore/ignore_test.go)
- [Glob library syntax](https://github.com/gobwas/glob)
