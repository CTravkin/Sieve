# Sieve

[Русский](README.md) · [English](README.en.md)

An Obsidian plugin that excludes files and folders before vault indexing.

## Status

The first version is in development. The common matcher, native oracle, early runtime, per-vault settings storage, English/Russian UI, and vault display names are implemented. Platform and performance checks continue. There is no public release.

Development version: `0.6.5 (18)`. The private runtime uses the complete matcher; diagnostic probes and benchmarks belong to the developer workspace. Native checks use separate synthetic vaults.

## Features

The agreed scope is early filtering with full Syncthing filter syntax, detailed help, and each vault's display name in the switching menu. Russian Obsidian uses RU; every other language uses EN. [Settings and recovery (Russian)](Docs/Settings.md); [Docs](Docs/README.md) contains the complete user references.

## Platforms

Target platforms are Windows, macOS, Linux, iOS, and Android. The common matcher has been compared with Syncthing 2.1.6 on Windows and Linux; the native Obsidian probe has been checked on Windows. These are separate checks. Full native acceptance across the target platforms remains incomplete. `minAppVersion: 1.14.4` is the target minimum.

## Operations

### Verification

Asset checks require Node.js 22 or newer and no dependency installation. TypeScript/core checks need `npm.cmd ci`; the native oracle requires Go 1.27.0. Versions and profiles are pinned in [Oracle](scripts/Oracle/README.md).

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:core
npm.cmd run test:oracle
npm.cmd run test:adapters
npm.cmd run test:settings
npm.cmd run test:ui
npm.cmd run test:alias
npm.cmd run test:regression
npm.cmd run build
```

On other platforms, omit `.cmd` from npm commands. `check`/`test` validate repository assets; `typecheck`/`test:core`/`test:oracle` validate the common engine. `test:adapters`/`test:settings` validate runtime and storage models; `test:ui`/`test:alias` validate the form, localization, and names. `build` creates the private package in `dist/sieve/`. Native Obsidian, system I/O, and UI need separate scenarios.

See [scripts](scripts/README.md) for build and packaging commands.

## Links

- [Filter syntax](Docs/Syntax.en.md)
- [Private installation and upgrade (Russian)](Docs/Private-Package.md)

A license for public distribution will be selected separately. The repository remains private until the owner explicitly authorizes publication.
