param([string]$Destination)
$ErrorActionPreference = 'Stop'
$sieveRepository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $PSScriptRoot 'package-paths.ps1')
$sieveArtifact = Assert-SievePackagePath -RepositoryRoot $sieveRepository -Path (Join-Path $sieveRepository 'dist\sieve')
$null = Assert-SievePackagePath -RepositoryRoot $sieveRepository -Path (Join-Path $sieveArtifact 'identity.json')
$null = Assert-SievePackagePath -RepositoryRoot $sieveRepository -Path (Join-Path $sieveArtifact 'manifest.json')
$sieveIdentity = Get-Content -LiteralPath (Join-Path $sieveArtifact 'identity.json') -Raw | ConvertFrom-Json
$sieveMetadata = Get-Content -LiteralPath (Join-Path $sieveRepository 'package.json') -Raw | ConvertFrom-Json
$sieveManifest = Get-Content -LiteralPath (Join-Path $sieveArtifact 'manifest.json') -Raw | ConvertFrom-Json
$sieveCommit = (& git -C $sieveRepository rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sieveIdentity.privateCandidate -ne $true -or $sieveIdentity.dirty -ne $false -or $sieveIdentity.gitCommit -ne $sieveCommit) { throw 'Rebuild the committed private candidate before packaging' }
$sieveWorktree = & git -C $sieveRepository status --porcelain
if ($LASTEXITCODE -ne 0 -or $sieveWorktree) { throw 'Commit the private candidate before packaging' }
if ($sieveManifest.id -ne 'sieve' -or $sieveManifest.version -ne $sieveMetadata.version -or $sieveIdentity.version -ne $sieveMetadata.version -or $sieveIdentity.build -ne $sieveMetadata.sieveBuild) { throw 'Package identity mismatch' }
if (-not $Destination) { $Destination = Join-Path $sieveRepository "dist\sieve-$($sieveIdentity.version)-$($sieveIdentity.build)-private.zip" }
$sieveOutput = [IO.Path]::GetFullPath($Destination)
if (-not $sieveOutput.StartsWith((Join-Path $sieveRepository 'dist') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Private packages belong in repository dist' }
$null = Assert-SievePackagePath -RepositoryRoot $sieveRepository -Path $sieveOutput -AllowMissingLeaf
if (Test-Path -LiteralPath $sieveOutput) { throw 'Preserve existing package; choose a new output filename' }
if ($sieveIdentity.files -isnot [pscustomobject]) { throw 'Package inventory must be an object' }
$sieveInventoryNames = @($sieveIdentity.files.PSObject.Properties.Name)
$sieveUniqueNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($sieveName in $sieveInventoryNames) {
    if ($sieveName.Equals('identity.json', [StringComparison]::OrdinalIgnoreCase) -or -not $sieveUniqueNames.Add($sieveName)) { throw 'Reserved or duplicate package inventory name' }
}
$sieveExpectedNames = @('main.js', 'manifest.json', 'INSTALL.md', 'THIRD-PARTY-NOTICES.md')
if (Test-Path -LiteralPath (Join-Path $sieveRepository 'styles.css')) { $sieveExpectedNames += 'styles.css' }
foreach ($sieveSourceDirectory in @('scripts\Oracle\licenses', 'src\core')) {
    $sieveSourcePath = Assert-SievePackagePath -RepositoryRoot $sieveRepository -Path (Join-Path $sieveRepository $sieveSourceDirectory)
    foreach ($sieveSourceEntry in Get-ChildItem -LiteralPath $sieveSourcePath -Force) {
        $null = Assert-SievePackagePath -RepositoryRoot $sieveRepository -Path $sieveSourceEntry.FullName
        if ($sieveSourceDirectory -eq 'scripts\Oracle\licenses') {
            if ($sieveSourceEntry.PSIsContainer) { throw 'Package license source must contain regular files' }
            $sieveExpectedNames += 'licenses/' + $sieveSourceEntry.Name
        } elseif (-not $sieveSourceEntry.PSIsContainer -and $sieveSourceEntry.Name -cmatch '\.ts$') { $sieveExpectedNames += 'src/core/' + $sieveSourceEntry.Name }
    }
}
if ([string]::Join('|', @($sieveInventoryNames | Sort-Object -CaseSensitive)) -cne [string]::Join('|', @($sieveExpectedNames | Sort-Object -CaseSensitive))) { throw 'Package inventory differs from the required builder file set' }
$sieveFiles = @('identity.json') + @($sieveInventoryNames | Sort-Object)
foreach ($sieveRelative in $sieveFiles) {
    if (-not $sieveRelative -or $sieveRelative.Contains('\') -or $sieveRelative.Contains(':') -or $sieveRelative.StartsWith('/') -or $sieveRelative.Contains('//') -or $sieveRelative -match '(^|/)\.\.?(/|$)') { throw 'Unsafe relative package inventory name' }
    $sieveFile = [IO.Path]::GetFullPath((Join-Path $sieveArtifact $sieveRelative))
    if (-not $sieveFile.StartsWith($sieveArtifact + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package inventory escapes artifact' }
    $null = Assert-SievePackagePath -RepositoryRoot $sieveRepository -Path $sieveFile
    if ($sieveRelative -ne 'identity.json' -and (Get-FileHash -LiteralPath $sieveFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sieveIdentity.files.$sieveRelative) { throw "Package hash mismatch: $sieveRelative" }
}
Add-Type -AssemblyName System.IO.Compression
$sieveStream = [IO.File]::Open($sieveOutput, [IO.FileMode]::CreateNew)
try {
    $sieveArchive = [IO.Compression.ZipArchive]::new($sieveStream, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($sieveRelative in $sieveFiles) {
            $sieveEntry = $sieveArchive.CreateEntry('sieve/' + $sieveRelative.Replace('\', '/'), [IO.Compression.CompressionLevel]::Optimal)
            $sieveEntry.LastWriteTime = [DateTimeOffset]::new(2026, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
            $sieveInput = [IO.File]::OpenRead((Join-Path $sieveArtifact $sieveRelative))
            $sieveEntryStream = $sieveEntry.Open()
            try { $sieveInput.CopyTo($sieveEntryStream) } finally { $sieveEntryStream.Dispose(); $sieveInput.Dispose() }
        }
    } finally { $sieveArchive.Dispose() }
} finally { $sieveStream.Dispose() }
$sieveReadback = [IO.Compression.ZipArchive]::new([IO.File]::OpenRead($sieveOutput), [IO.Compression.ZipArchiveMode]::Read)
try {
    if ($sieveReadback.Entries.Count -ne $sieveFiles.Count) { throw 'Package entry count mismatch' }
    $sieveExpectedZipNames = @($sieveFiles | ForEach-Object { 'sieve/' + $_ })
    $sieveActualZipNames = @($sieveReadback.Entries | ForEach-Object { $_.FullName })
    $sieveZipUnique = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($sieveZipName in $sieveActualZipNames) { if (-not $sieveZipUnique.Add($sieveZipName)) { throw 'Duplicate ZIP entry name' } }
    if ([string]::Join('|', @($sieveActualZipNames | Sort-Object -CaseSensitive)) -cne [string]::Join('|', @($sieveExpectedZipNames | Sort-Object -CaseSensitive))) { throw 'ZIP entry names differ from the exact inventory' }
    foreach ($sieveEntry in $sieveReadback.Entries) {
        $sieveRelative = $sieveEntry.FullName.Substring(6)
        $sieveEntryStream = $sieveEntry.Open()
        $sieveHasher = [Security.Cryptography.SHA256]::Create()
        try { $sieveHash = [BitConverter]::ToString($sieveHasher.ComputeHash($sieveEntryStream)).Replace('-', '').ToLowerInvariant() } finally { $sieveHasher.Dispose(); $sieveEntryStream.Dispose() }
        $sieveExpected = if ($sieveRelative -eq 'identity.json') { (Get-FileHash -LiteralPath (Join-Path $sieveArtifact 'identity.json') -Algorithm SHA256).Hash.ToLowerInvariant() } else { $sieveIdentity.files.$sieveRelative }
        if ($sieveHash -ne $sieveExpected) { throw 'Package readback hash mismatch' }
    }
} finally { $sieveReadback.Dispose() }
[pscustomobject]@{ path=$sieveOutput; version=$sieveIdentity.version; build=$sieveIdentity.build; gitCommit=$sieveCommit; files=$sieveFiles.Count; sha256=(Get-FileHash -LiteralPath $sieveOutput -Algorithm SHA256).Hash } | ConvertTo-Json
