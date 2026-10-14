param(
    [Parameter(Mandatory = $true)][string]$RunDirectory,
    [ValidateSet('Baseline', 'Filtered', 'Descendant', 'SieveFirst', 'SieveLast', 'Alternate')][string]$Variant = 'Filtered',
    [switch]$AlreadyEnabled,
    [string]$ObsidianPath = "$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe"
)
$ErrorActionPreference = 'Stop'
$sieveRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$sieveAllowed = [IO.Path]::GetFullPath((Join-Path $sieveRepo 'Local\.temp\SieveProbe')) + [IO.Path]::DirectorySeparatorChar
$sieveRun = (Resolve-Path -LiteralPath $RunDirectory).Path
if (-not ($sieveRun + [IO.Path]::DirectorySeparatorChar).StartsWith($sieveAllowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Only generated Sieve fixtures are allowed' }
$sieveDefinition = Get-Content -LiteralPath (Join-Path $sieveRun 'run.json') -Raw | ConvertFrom-Json
if ($sieveDefinition.runtimeFixture -ne $true) { throw 'Actual runtime fixture marker missing' }
$sieveVariant = $sieveDefinition.vaults | Where-Object name -EQ $Variant
if (-not $sieveVariant) { throw 'Unknown fixture variant' }
foreach ($sieveTarget in @($sieveVariant.vault, $sieveVariant.profile)) {
    if (-not [IO.Path]::GetFullPath($sieveTarget).StartsWith($sieveRun + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture path escapes the selected run' }
}
$sievePhysicalCheck = @'
const fs=require('fs');const path=require('path');const real=p=>{const value=fs.realpathSync(p).replaceAll('\\','/');return process.platform==='win32'?value.toLowerCase():value;};const [repo,root,run,...targets]=process.argv.slice(1).map(real);if(!root.startsWith(repo+'/')||!run.startsWith(root+'/')||!targets.every(p=>p.startsWith(run+'/')))throw Error('Fixture junction or symlink escapes selected run');process.stdout.write('PASS');
'@
$sieveBoundary = & node.exe -e $sievePhysicalCheck $sieveRepo $sieveAllowed $sieveRun $sieveVariant.vault $sieveVariant.profile
if ($LASTEXITCODE -ne 0 -or $sieveBoundary -ne 'PASS') { throw 'Physical fixture boundary failed before app launch' }
$sieveReports = Join-Path $sieveRun 'Reports'
New-Item -ItemType Directory -Path $sieveReports -Force | Out-Null
$sieveStamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss-fffZ')
$sievePrefix = Join-Path $sieveReports "$sieveStamp-$Variant"
$sieveInspector = Join-Path $PSScriptRoot 'inspect.mjs'
function Start-SieveHost {
    if (@(Get-CimInstance Win32_Process -Filter "Name = 'Obsidian.exe'").Count -ne 0) { throw 'Preserve existing Obsidian processes' }
    if (Get-NetTCPConnection -LocalPort 9229 -State Listen -ErrorAction SilentlyContinue) { throw 'Debugger port 9229 is in use' }
    $sieveArgs = @(('--user-data-dir="' + $sieveVariant.profile + '"'), '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9229')
    $sieveHost = Start-Process -FilePath $ObsidianPath -ArgumentList $sieveArgs -WindowStyle Hidden -PassThru
    [pscustomobject]@{pid=$sieveHost.Id;profile=$sieveVariant.profile;vault=$sieveVariant.vault;arguments=$sieveArgs} | ConvertTo-Json | Set-Content -LiteralPath "$sievePrefix-process-$($sieveHost.Id).json"
    return $sieveHost
}
function Stop-SieveHost($sieveHost, $sieveSuffix) {
    & node.exe $sieveInspector 9229 "$sievePrefix-$sieveSuffix.json" quit
    if ($LASTEXITCODE -ne 0) { throw 'Native quit failed; preserve process for diagnosis' }
    if (-not $sieveHost.WaitForExit(10000)) { throw 'Native app did not exit normally' }
}
if (-not $AlreadyEnabled) {
    $sieveHost = Start-SieveHost
    try {
        if ($sieveVariant.configDir) {
            & node.exe $sieveInspector 9229 "$sievePrefix-config-dir.json" config-dir $sieveVariant.configDir
            if ($LASTEXITCODE -ne 0) { throw 'ConfigDir selection failed' }
            Stop-SieveHost $sieveHost 'config-quit'
            $sieveHost = $null
            $sieveHost = Start-SieveHost
        }
        & node.exe $sieveInspector 9229 "$sievePrefix-enable.json" activate
        if ($LASTEXITCODE -ne 0) { throw 'Runtime activation failed' }
    } finally { if ($sieveHost) { Stop-SieveHost $sieveHost 'enable-quit' } }
}
$sieveHost = Start-SieveHost
try {
    & node.exe $sieveInspector 9229 "$sievePrefix-startup.json" report
    if ($LASTEXITCODE -ne 0) { throw 'Native startup report failed' }
    $sieveProcesses = @(Get-Process -Name Obsidian -ErrorAction Stop | ForEach-Object { [pscustomobject]@{pid=$_.Id;cpuSeconds=$_.CPU;workingSetBytes=$_.WorkingSet64;peakWorkingSetBytes=$_.PeakWorkingSet64} })
    [pscustomobject]@{ measuredAfterLayout=$true; processes=$sieveProcesses; cpuSeconds=($sieveProcesses | Measure-Object cpuSeconds -Sum).Sum; workingSetBytes=($sieveProcesses | Measure-Object workingSetBytes -Sum).Sum; aggregateProcessPeakWorkingSetBytes=($sieveProcesses | Measure-Object peakWorkingSetBytes -Sum).Sum } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$sievePrefix-process-metrics.json"
} finally { Stop-SieveHost $sieveHost 'startup-quit' }
Write-Output "Report: $sievePrefix-startup.json"
