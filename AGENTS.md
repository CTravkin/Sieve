# Sieve

## Project

Obsidian plugin for filtering files and folders before vault indexing. This directory is a separate Git repository owned by `CTravkin/Sieve`; keep Git operations inside this repository.

Read [Requirements](Docs/Requirements.md), [Versioning](Docs/Versioning.md), and the relevant [English](Docs/Syntax.en.md) or [Russian](Docs/Syntax.ru.md) syntax reference before changing behavior.
Before starting implementation, read the [development plan](Plans/Development.md) and resolve decisions that block the selected stage.

## Implementation

- Full Syncthing filter syntax is required; Syncthing 2.1.6 is the initial reference implementation. Confirm matching and traversal behavior against its native matcher.
- English and Russian are required. Main settings strings belong in `src/locales/en.json` and `src/locales/ru.json`; their keys and placeholders must match.
- Mention Syncthing compatibility in detailed syntax help and GitHub documentation, never in the main settings screen or manifest description.
- Target desktop, iOS, and Android. Node.js and Electron must not be imported into shared/mobile code. Platform support remains unverified until actual host/device checks pass.
- Filtering must preserve source files and Obsidian's access to its configuration. Never implement deletion as a filtering side effect.
- Settings are scoped to the current vault. The UI must not claim that saved rules have been applied unless application is verified.
- Rules are edited in the UI or `<configDir>/plugins/sieve/data.json`. Apply after reopening the vault; successful UI saves offer a vault reload. Russian Obsidian uses RU, every other language uses EN.

## Verification and Delivery

- Run `npm.cmd run check` and `npm.cmd test` on Windows before committing. These validate assets and diagnostic hooks; native host evidence is a separate check.
- Development versions start with major 0 and increase with new source builds; build numbers do not reset at release. Follow [Versioning](Docs/Versioning.md) and use `X.Y.Z (N)` for versioned commit prefixes. Constantine assigns the public release version separately.
- [Probe tools](Tools/TOOLS.md) create disposable fixtures and diagnostic packages only. Their prefix classifier is not the production Syncthing matcher. Do not install a probe into a user vault.
- Keep the repository private until Constantine explicitly authorizes publication. Do not create a release or change visibility as part of routine development.
