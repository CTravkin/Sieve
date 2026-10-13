# Sieve

[Русский](README.md) · [English](README.en.md)

An Obsidian plugin that excludes files and folders before vault indexing.

## Status

The first version is in development. The repository contains translations, syntax help, requirements, and an early traversal diagnostic probe. The full filtering engine and settings UI are not implemented yet; there is no installable release.

Development version: `0.2.0 (2)`. The probe is only for disposable test vaults and does not implement filter syntax. [Probe commands and limitations (Russian)](Tools/TOOLS.md).

## Features

The agreed scope is early filtering with full Syncthing filter syntax, detailed help, and a display name for the current vault. The interface will support English and Russian. [Requirements](Docs/Requirements.md) owns the scope and limitations.

## Platforms

Target platforms are Windows, macOS, Linux, iOS, and Android. Filtering and UI behavior have not been verified on them. `minAppVersion: 1.14.4` is the initial target minimum, not a claim of tested plugin compatibility.

## Operations

### Verification

Asset checks require Node.js 22 or newer. No dependency installation is needed.

```powershell
npm.cmd run check
npm.cmd test
```

On other platforms, use `npm run check` and `npm test`. These commands validate translation structure, copy, version metadata, and local Markdown links. They do not validate early filtering or Obsidian compatibility.

## Links

- [Development plan (Russian)](Plans/Development.md)
- [Filter syntax](Docs/Syntax.en.md)
- [Version and build policy](Docs/Versioning.md)

A license for public distribution will be selected separately. The repository remains private until the owner explicitly authorizes publication.
