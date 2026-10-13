# Sieve

[Русский](README.md) · [English](README.en.md)

An Obsidian plugin that excludes files and folders before vault indexing.

## Status

The first version is in development. The common matcher and native oracle are implemented; a separate Windows diagnostic probe checks early traversal. Plugin integration, settings, and display names are still in progress; there is no installable release.

Development version: `0.3.0 (3)`. The diagnostic probe is only for disposable test vaults and uses a prefix classifier. [Commands and verification boundaries (Russian)](Tools/TOOLS.md).

## Features

The agreed scope is early filtering with full Syncthing filter syntax, detailed help, and a display name for the current vault. The interface will support English and Russian. [Requirements](Docs/Requirements.md) owns the scope and limitations.

## Platforms

Target platforms are Windows, macOS, Linux, iOS, and Android. The common matcher has been compared with Syncthing 2.1.6 on Windows and Linux; the native Obsidian probe has been checked on Windows. These are separate checks. See [Compatibility](Docs/Compatibility.md) for integration status. `minAppVersion: 1.14.4` is the target minimum.

## Operations

### Verification

Asset checks require Node.js 22 or newer and no dependency installation. TypeScript/core checks need `npm.cmd ci`; the native oracle requires Go 1.27.0. Versions and profiles are pinned in [Oracle](Tools/Oracle/README.md).

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:core
npm.cmd run test:oracle
```

On other platforms, omit `.cmd` from npm commands. `check`/`test` validate assets and diagnostic hooks; `typecheck`/`test:core`/`test:oracle` validate the common engine. Native Obsidian, system I/O, and UI need separate scenarios.

## Links

- [Development plan (Russian)](Plans/Development.md)
- [Filter syntax](Docs/Syntax.en.md)
- [Version and build policy](Docs/Versioning.md)

A license for public distribution will be selected separately. The repository remains private until the owner explicitly authorizes publication.
