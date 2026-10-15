# Native matcher oracle

This test-only harness calls unchanged Syncthing v2.1.6 `lib/ignore` and `lib/scanner` libraries. [pin.json](pin.json) records the annotated tag, peeled commit, glob replacement, Go/Unicode revisions and platform profiles. `go.mod`/`go.sum` pin the complete dependency graph. No oracle code is bundled into Sieve's common runtime.

Run from the repository root:

```powershell
npm.cmd run typecheck
npm.cmd run test:core
npm.cmd run test:oracle
```

`npm.cmd run test:oracle` uses `../run-tests.mjs --oracle`: it compiles one binary with `go build -mod=readonly -trimpath` in its own directory under `../Local/.temp/Development/`, then shares that executable with every test worker through `SIEVE_ORACLE_BINARY`. The wrapper removes its build and fixture directories in `finally`, including failed test runs. Each native request also removes its own generated fixture directory. It never loads a user vault. Normal root asset tests do not download Go dependencies.

Direct `runner.mjs` callers without a supplied executable create one process-local disposable build under `../Local/.temp/Oracle/`. `cleanupOracle()` releases it explicitly; a `beforeExit` fallback releases it after outstanding work finishes. Cleanup never adopts preexisting directories or follows junction targets. Forced process or host termination can prevent cleanup. There is no persistent binary cache.

The suite wrapper handles SIGINT/SIGTERM from the start of preparation. Cancellation during compilation waits for that build to settle, then cleans its files without starting tests; it does not forcibly terminate Go. During tests, the wrapper forwards the signal and waits for its child to close before cleanup. Signal exit codes are 130/143, and handlers are detached after cleanup.

For a host without Go, cross-build the same source and set `SIEVE_ORACLE_BINARY` to the explicitly supplied executable path. The wrapper and runner reuse that executable without taking ownership or deleting it. The runner checks that path is executable; it does not download or install a binary. Execute the tests on the real target OS to obtain its native case-fold/normalization profile. Cross-compilation alone is not native verification.

## Protocol

The binary reads one JSON array of fixtures from stdin and writes one JSON array of results to stdout. A fixture contains `name`, `rules`, `paths`, optional `files` (UTF-8 contents), `bytes` (number arrays or base64 strings), `basic`, `aliases`, `permissions`, and `tree` (file paths for native scanner verification).

`rules` is parsed as a virtual `.stignore` at the filesystem root. Fake filesystems exercise arbitrary pattern strings. `basic` uses an isolated real filesystem; `tree` enables `scanner.WalkWithoutHashing`. `{{root}}` and `{{outside}}` in real fixture text refer only to generated paths. Fixture writes stay inside the generated sandbox. Include escape, absolute-path joins, symlink aliases and native permission errors are characterized by the filesystem tests.

Results contain the actual runtime OS/architecture/toolchain/Unicode profile, upstream commit, expanded native patterns, native pattern hash, input lines, four flags per path, or the native parse/read error. Errors return no path matches. Scanner results list visible files/directories and errors; the tests additionally compare exhaustive/pruned walks and minimal parent containers.

Additional commands:

- `unicode-lower`: every Go simple lowercase rune mapping
- `unicode-normalization`: pinned canonical decomposition, CCC, composition and stream-safe properties
- `normalize`: JSON string array on stdin, native NFC/NFD results on stdout
- `node scripts/Oracle/generate-unicode.mjs`: reproducibly generate the portable Unicode 17 tables with a checked toolchain
- `node scripts/Oracle/minimize.mjs`: minimize the saved generated mismatch corpus into replay fixtures; use before fixing a mismatch

Native errors and quirks are compatibility evidence. For example, the pinned glob optimizer matches `a/**/b` against `a/b`, and some compound wildcard matchers use UTF-8 byte offsets. The port preserves these results. The matcher accepts clean relative paths in native Unicode normalization; normalization is available to adapters separately from `matcher.match`.

Unavailable OS tests remain `NOT_TESTED`. The Windows run skips native Unix permission-denial and symlink tests. JavaScript profile simulation is not native macOS/iOS/Android evidence.
