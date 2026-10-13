# Third-party notices

Sieve remains private and its original code remains under the repository's `UNLICENSED` designation. The following notices identify upstream code/data reused in the portable matcher and its tests. They do not change the license of unrelated Sieve code.

## Syncthing

Copyright (C) 2014, 2015, 2024 The Syncthing Authors.

Source: [Syncthing v2.1.6](https://github.com/syncthing/syncthing/tree/v2.1.6), commit `4461a1ce354d3990660966ad70176e00246adb61`. The annotated tag object is `28000330a4f4f24e03018333ab31846774c6a9a1`.

The ignore parser, pattern expansion, order, flags, pruning and special-name logic in `src/core/parser.ts` and `src/core/matcher.ts`, and fixtures in `Tests/Fixtures/upstream.mjs`, are adapted from `lib/ignore`, `lib/ignore/ignoreresult`, `lib/fs/filesystem.go`, `lib/fs/tempname.go` and `lib/ignore/ignore_test.go`. Adapted Covered Software is subject to the Mozilla Public License, version 2.0. The source files retain notices; the complete license is [MPL-2.0.txt](Tools/Oracle/licenses/MPL-2.0.txt).

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, you can obtain one at https://mozilla.org/MPL/2.0/.

## Glob

`src/core/glob.ts` adapts the lexer, AST, compiler optimizations and matcher behavior from [github.com/calmh/glob](https://github.com/calmh/glob/tree/1d823af5017b), commit `1d823af5017b`. Syncthing replaces `github.com/gobwas/glob v0.2.3` with this fork; the oracle preserves that exact replacement.

The complete MIT notice, including copyright and permission terms, is [glob-MIT.txt](Tools/Oracle/licenses/glob-MIT.txt). Copyright (c) 2016 Sergey Kamardin.

## Go and Unicode data

`src/core/unicode-lower.ts` and `src/core/unicode-normalization.ts` are generated from Go 1.27.0 Unicode 17.0.0 and `golang.org/x/text v0.41.0`. `src/core/normalize.ts` reproduces the relevant native stream-safe normalization behavior. The data and algorithm reference come from the Go Authors and Unicode data.

Copyright 2009 The Go Authors. Copyright 2011 The Go Authors. All rights reserved. The complete Go BSD notice is [Go-BSD-3-Clause.txt](Tools/Oracle/licenses/Go-BSD-3-Clause.txt). The Unicode copyright and permission notice is [Unicode-3.0.txt](Tools/Oracle/licenses/Unicode-3.0.txt), downloaded from [Unicode](https://www.unicode.org/license.txt).

## Native test oracle

`Tools/Oracle/main.go` links the unchanged pinned Syncthing `lib/ignore` and `lib/scanner` libraries for verification. Their complete dependency versions and checksums are in `Tools/Oracle/go.mod` and `Tools/Oracle/go.sum`; source licenses remain in the corresponding downloaded Go modules. The native binary is a local test artifact and is not included in the portable runtime. [pin.json](Tools/Oracle/pin.json) records the upstream revision and platform profiles. Redistribution of an oracle binary requires preserving its dependencies' notices.

Portable runtime bundles retain `@license` comments. Include this notice and its referenced license texts with any future distribution of the adapted code; public release and licensing remain separate owner decisions.
