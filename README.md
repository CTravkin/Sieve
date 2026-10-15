# Sieve

Sieve filters files and folders before Obsidian indexes a vault. It keeps generated files, dependency trees and other unwanted content out of the file explorer, search and metadata index, without moving or deleting the original files.

## Features

- **Early filtering.** Excluded subtrees can be skipped during vault scanning, reducing indexing work in large folders.
- **Ordered rules.** Syncthing-compatible patterns support include exceptions, directory anchors, case handling and external rule files. The first matching rule wins.
- **Vault names.** A display name can replace the folder name in vault labels and switching menus without changing the path or vault ID.
- **Safe configuration.** Rules are checked before saving. One previous working configuration is retained for recovery; without a valid configuration, the vault opens unfiltered with an error notice.
- **Offline help and localization.** Settings and built-in syntax help use Russian for a Russian Obsidian interface and English for other languages.

## Platforms

Obsidian 1.14.4 or later is required. Desktop behavior has been tested on Windows; the matcher has also been checked against native Syncthing on Linux. macOS, iOS and Android share the portable implementation but have not been verified on devices.

For display names in other mobile vaults, the current provider reads the standard `.obsidian` directory. Custom configuration locations in those vaults are not yet supported.

Filtering uses Obsidian internals. Unsupported runtime structures leave the vault unfiltered and show a notice.

## Data access

Sieve runs locally without network requests or telemetry. On desktop, vault display names read Obsidian's vault registry and Sieve settings in other registered vaults. Included rule files are read from the configured paths, which can be outside the current vault. Writes are limited to Sieve's settings and its single recovery snapshot.

## Operations

### Installation

Download the plugin ZIP from [GitHub Releases](https://github.com/CTravkin/Sieve/releases) and extract its `sieve` folder into `<vault>/.obsidian/plugins/`. A custom Obsidian configuration directory can be used instead of `.obsidian`.

Enable Sieve under **Settings → Community plugins**, then reopen the vault. The initial enable happens after the vault has loaded; early filtering begins on the next opening.

For an update, replace the package files while preserving `data.json` and `data.previous.json`.

### Build

Node.js 22 or later is required. From `Plugin`:

```sh
npm ci
npm run build
```

The installable files are written to `Builds/sieve`. After committing the source, PowerShell 7 can create the verified ZIP:

```powershell
./scripts/package.ps1
```

The archive name is `Sieve X.Y.Z (build N).zip`. Build output is local and excluded from Git.

### Usage

Open **Settings → Sieve**, or find its fields through Obsidian's settings search. Add one rule per line. For example:

```text
!important
*.tmp
/build
**/cache
```

Rules are relative to the vault root. Saving offers a reload; postponing keeps the current rules active until the vault is reopened. Closing settings discards unsaved edits.

Settings can also be edited in `<configDir>/plugins/sieve/data.json`:

```json
{
  "schemaVersion": 1,
  "rules": "*.tmp\n/build",
  "displayName": ""
}
```

An empty display name uses the root folder name. Manual rule changes apply after reopening the vault. After disabling Sieve, reopen the vault to restore the ordinary index. Filtering never deletes source files.

### Verification

From `Plugin`:

```sh
npm run check
npm run typecheck
npm run test:regression
npm run test:core
npm run test:oracle
npm run test:package
```

The native matcher comparison requires Go 1.27.0. Tests use owned temporary directories and clean them after the run. `SIEVE_TEST_TEMP` selects their parent directory; `SIEVE_ORACLE_BINARY` supplies a prebuilt native oracle. Automated checks do not replace testing in Obsidian or on mobile devices.

## Branches

| Branch | Purpose |
| --- | --- |
| `dev` | Development |
| `release` | Published versions and GitHub releases; default branch |

Release tags use `X.Y.Z`; release titles use `Sieve X.Y.Z (build N)`. Each release includes a changelog and the individual Obsidian assets as well as the ZIP.

## Links

- [Filter syntax — English](Docs/Syntax.en.md) · [Русский](Docs/Syntax.ru.md)
- [MPL-2.0 license](LICENSE)
- [Third-party notices](Docs/THIRD-PARTY-NOTICES.md)
