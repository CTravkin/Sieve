# Sieve

## Project

### Purpose

Obsidian plugin that filters files and folders before vault indexing.

### Structure

This is the separate private `CTravkin/Sieve` application repository inside
the [CJA PC workspace](../AGENTS.md). Source, tests, build scripts, the native
matcher oracle and shipped documentation stay here. Internal requirements,
architecture, acceptance and version policy belong to `../Docs/Sieve`.
Diagnostic probes and benchmarks belong to `../Tools/Sieve`. Shared reports
and inherited plans belong to the parent workspace; do not create parallel
task-material trees here. Standalone checkouts do not require these siblings.

### Constraints

Filtering preserves source files and Obsidian's configuration access; deletion
must never be a filtering side effect. Keep the repository private until
Constantine authorizes publication. Native platform support requires actual
host/device evidence; source-based hypotheses alone do not pass that gate.

## Files

### Navigation

| Location | Purpose |
| --- | --- |
| [Docs](Docs/README.md) | Shipped syntax, settings and installation references |
| [Work](../Work/README.md) | Shared work register |
| [Legacy plan](<../Work/Plans/Sieve/2026-10-13 23-01 Разработка Sieve - План выполнения.md>) | Development stages and acceptance gates |
| [Dev](../Dev/README.md) | Shared implementation reports and state |
| [QA](../QA/README.md) | Shared verification reports and evidence |
| [Review](../Review/README.md) | Shared engineering reviews |
| [Ops](../Ops/README.md) | Shared operational results |
| [scripts](scripts/README.md) | Repository build, packaging and native matcher verification |
| [Diagnostics](../Tools/Sieve/README.md) | Workspace probes and benchmarks |

### Storage

Keep application configuration, assets, source and tests in their native paths.
Local state belongs to the shared `../Local`; tests and oracle use its `.temp`.
Serena uses the ignored `.serena` junction to `../Local/.tools/Serena/Sieve`.
Do not recreate a repository-local Local. Generated `dist` stays untracked. Disposable probe
fixtures and diagnostics follow the shared diagnostics inventory and shared-workspace storage.
Keep only useful evidence after task cleanup.

### Git

`main` is the retained application branch. Track source, tests, assets, build
configuration, lockfiles, READMEs, application Docs and these instructions.
Keep runtime state, generated packages, environments and shared task materials
local. The root `.gitignore` owns this policy; tracked Docs and AGENTS are
explicit exceptions to the general local-material baseline.

## Context

### Sources

| Topic | Source | Purpose |
| --- | --- | --- |
| Artifact templates | [Templates](../../../.codex/Templates/README.md) | Shared artifact formats and registers |
| Product guarantees | [Requirements](../Docs/Sieve/Requirements.md) | Filtering, settings and platform contracts |
| Version policy | [Versioning](../Docs/Sieve/Versioning.md) | Authoritative version/build rules |
| Matcher syntax | [English](Docs/Syntax.en.md) · [Russian](Docs/Syntax.ru.md) | Full supported syntax |
| Packaging | [Private package](Docs/Private-Package.md) | Candidate inventory and clean-build requirements |

### Documentation

Read relevant contracts and the selected development stage before behavior
changes; resolve only decisions that block that stage. Update affected documents,
registers and path consumers. These instructions stay English; shipped syntax
references and localization retain their English/Russian language pairs.

## Work

### Development

- Implement the full Syncthing filter syntax; Syncthing 2.1.6 is the initial
  reference. Confirm matching and traversal against its native matcher.
- EN/RU settings strings belong to `src/locales/en.json` and `ru.json`;
  keys and placeholders must match. Mention compatibility in detailed help and
  GitHub documentation, never in the main settings screen or manifest description.
- Use native `SettingGroup` cards and settings typography. Custom CSS is limited
  to necessary layout, agreed control sizes, emphasis and readable status colors.
- Target desktop, iOS and Android. Node/Electron do not enter shared/mobile
  code; desktop-specific access remains behind its platform boundary.
- Constantine permits common development and source-based platform hypotheses
  when native checks are unavailable. Record those hypotheses separately.
- Settings belong to the current vault; do not claim application before it is
  verified. Rules use the UI or `<configDir>/plugins/sieve/data.json` and apply
  after reopening the vault; successful UI saves offer reload. Russian Obsidian
  uses RU, every other language uses EN.
- Validate rules on blur and Save, without writing on blur. Closing settings
  discards the draft; stale asynchronous results must not restore it. Disable
  Save for unchanged values, unavailable storage or known invalid rules.
- Vault-switching menus show each vault's configured display name. Updating only
  the active label is insufficient; preserve filesystem paths and vault IDs.
- Retain one previous working configuration on changed saves. Startup errors
  use it; without one, open unfiltered and show the error. Do not accumulate history.
- Probe tools create disposable fixtures and diagnostic packages only. Their
  prefix classifier is not the production matcher; never install a probe in a user vault.

### Checks

| Check | Working directory | Command or scenario | Prerequisites and limits |
| --- | --- | --- | --- |
| Assets and diagnostic hooks | This repository | `npm.cmd run check` and `npm.cmd test` | Required before commits; separate from native host evidence |
| Private candidate | This repository | `npm.cmd run test:regression` and `npm.cmd run test:package` | Required for ZIP delivery, together with clean commit and exact verified inventory |
| Platform acceptance | Actual host/device | Selected plan's native scenarios | Name unperformed gates; common-code tests do not prove support |

Performance changes require functional regression checks as well as comparable
timings: direct file access, native events, links/metadata, hidden transitions and
cleanup must stay operational. Record installed identity and distinguish API
evidence from editor/UI evidence. Use exact vault IDs when names are ambiguous;
never select a working vault by basename alone. Workspace diagnostics are optional
for standalone checkouts; retain the same behavioral acceptance boundaries.

Test scripts use `scripts/run-tests.mjs` and run-owned temporary directories.
Preserve preexisting fixtures and explicitly supplied oracle executables.
Runtime test bundles stay in memory; native oracle workers share one run-owned
build. See `scripts/README.md` for direct invocation and cleanup limits.

### Versioning

`package.json` owns `version` and integer `sieveBuild`; synchronize
`manifest.json`, `versions.json`, lockfiles, displays and related tests.
The agreed display/commit format is `X.Y.Z (N)`. X is assigned by Constantine
and remains 0 until the first public release; Y changes for capabilities, Z for
fixes, with lower parts reset on higher-part increments. Each new non-documentation
revision/source build increments N and Y or Z. Documentation-only changes and
rebuilds of unchanged inputs do not bump versions. N never resets at release.
Source fingerprints and clean ZIP SHA rules are defined in Versioning; do not
invent values or reuse a published tag for another build.

### Delivery

Use the canonical scripts build/packaging commands and Private-Package procedure.
Private ZIPs require a clean local commit, matching identity and exact verified
inventory. Native installation and performance checks remain separate.
Public release version, license, release creation and repository visibility
require Constantine's explicit decision.
