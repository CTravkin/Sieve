# Native matcher oracle

This test-only harness calls unchanged Syncthing v2.1.6 `lib/ignore` and `lib/scanner` libraries. [pin.json](pin.json) records the annotated tag, peeled commit, glob replacement, Go/Unicode revisions and platform profiles. `go.mod`/`go.sum` pin the complete dependency graph. No oracle code is bundled into Sieve's common runtime.

Run from the repository root:

```powershell
npm.cmd run typecheck
npm.cmd run test:core
npm.cmd run test:oracle
```

`runner.mjs` compiles the binary with `go build -mod=readonly -trimpath` and stores it under ignored `Local/.temp/Oracle/`. Each request creates a disposable fixture there and removes only its generated fixture directory. It never loads a user vault. Normal root asset tests do not download Go dependencies.

For a host without Go, cross-build the same source and set `SIEVE_ORACLE_BINARY` to the explicitly supplied executable path. The runner checks that path is executable; it does not download or install a binary. Execute the tests on the real target OS to obtain its native case-fold/normalization profile. Cross-compilation alone is not native verification.

## Protocol

The binary reads one JSON array of fixtures from stdin and writes one JSON array of results to stdout. A fixture contains `name`, `rules`, `paths`, optional `files` (UTF-8 contents), `bytes` (number arrays or base64 strings), `basic`, `aliases`, `permissions`, and `tree` (file paths for native scanner verification).

`rules` is parsed as a virtual `.stignore` at the filesystem root. Fake filesystems exercise arbitrary pattern strings. `basic` uses an isolated real filesystem; `tree` enables `scanner.WalkWithoutHashing`. `{{root}}` and `{{outside}}` in real fixture text refer only to generated paths. Fixture writes stay inside the generated sandbox. Include escape, absolute-path joins, symlink aliases and native permission errors are characterized by the filesystem tests.

Results contain the actual runtime OS/architecture/toolchain/Unicode profile, upstream commit, expanded native patterns, native pattern hash, input lines, four flags per path, or the native parse/read error. Errors return no path matches. Scanner results list visible files/directories and errors; the tests additionally compare exhaustive/pruned walks and minimal parent containers.

Additional commands:

- `unicode-lower`: every Go simple lowercase rune mapping
- `unicode-normalization`: pinned canonical decomposition, CCC, composition and stream-safe properties
- `normalize`: JSON string array on stdin, native NFC/NFD results on stdout
- `node Tools/Oracle/generate-unicode.mjs`: reproducibly generate the portable Unicode 17 tables with a checked toolchain
- `node Tools/Oracle/minimize.mjs`: minimize the saved generated mismatch corpus into replay fixtures; use before fixing a mismatch

Native errors and quirks are compatibility evidence. For example, the pinned glob optimizer matches `a/**/b` against `a/b`, and some compound wildcard matchers use UTF-8 byte offsets. The port preserves these results. The matcher accepts clean relative paths in native Unicode normalization; normalization is available to adapters separately from `matcher.match`.

Unavailable OS tests remain `NOT_TESTED`. The Windows run skips native Unix permission-denial and symlink tests. JavaScript profile simulation is not native macOS/iOS/Android evidence.
