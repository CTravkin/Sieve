param(
    [Parameter(Mandatory = $true)][string]$RunDirectory,
    [ValidateSet('Baseline', 'Filtered', 'Descendant', 'SieveFirst', 'SieveLast', 'Alternate')][string]$Variant = 'Filtered',
    [string]$ObsidianPath = "$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe"
)
$ErrorActionPreference = 'Stop'
$probeRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$probeAllowedRoot = [IO.Path]::GetFullPath((Join-Path $probeRepo 'Local\.temp\SieveProbe')) + [IO.Path]::DirectorySeparatorChar
$probeRun = (Resolve-Path -LiteralPath $RunDirectory).Path
if (-not ($probeRun + [IO.Path]::DirectorySeparatorChar).StartsWith($probeAllowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Only generated Sieve fixtures are allowed' }
$probeDefinition = Get-Content -LiteralPath (Join-Path $probeRun 'run.json') -Raw | ConvertFrom-Json
$probeVariant = $probeDefinition.vaults | Where-Object name -EQ $Variant
foreach ($probeTarget in @($probeVariant.vault, $probeVariant.profile)) {
    if (-not [IO.Path]::GetFullPath($probeTarget).StartsWith($probeRun + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture path escapes the selected run' }
}
$probePhysicalCheck = @'
const fs=require('fs');const real=p=>{const value=fs.realpathSync(p).replaceAll('\\','/');return process.platform==='win32'?value.toLowerCase():value;};const [repo,root,run,...targets]=process.argv.slice(1).map(real);if(!root.startsWith(repo+'/')||!run.startsWith(root+'/')||!targets.every(p=>p.startsWith(run+'/')))throw Error('Fixture junction or symlink escapes selected run');process.stdout.write('PASS');
'@
$probeBoundary = & node.exe -e $probePhysicalCheck $probeRepo $probeAllowedRoot $probeRun $probeVariant.vault $probeVariant.profile
if ($LASTEXITCODE -ne 0 -or $probeBoundary -ne 'PASS') { throw 'Physical fixture boundary failed before app launch' }
$probeReports = Join-Path $probeRun 'Reports'
New-Item -ItemType Directory -Path $probeReports -Force | Out-Null
$probeStamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss-fffZ')
$probePrefix = Join-Path $probeReports "$probeStamp-$Variant"
$probeInspector = Join-Path $PSScriptRoot 'inspect.mjs'
function Start-ProbeHost {
    if (@(Get-CimInstance Win32_Process -Filter "Name = 'Obsidian.exe'").Count -ne 0) { throw 'Preserve existing Obsidian processes; close only the current probe before running this tool' }
    if (Get-NetTCPConnection -LocalPort 9229 -State Listen -ErrorAction SilentlyContinue) { throw 'Debugger port 9229 is already in use' }
    $probeArgs = @(('--user-data-dir="' + $probeVariant.profile + '"'), '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9229')
    $probeHost = Start-Process -FilePath $ObsidianPath -ArgumentList $probeArgs -WindowStyle Hidden -PassThru
    [pscustomobject]@{pid=$probeHost.Id; profile=$probeVariant.profile; vault=$probeVariant.vault; arguments=$probeArgs} | ConvertTo-Json | Set-Content -LiteralPath "$probePrefix-process-$($probeHost.Id).json"
    Start-Sleep -Milliseconds 2000
    return $probeHost
}
function Stop-ProbeHost($probeHost, $probeSuffix) {
    & node.exe $probeInspector 9229 "$probePrefix-$probeSuffix.json" quit
    if ($LASTEXITCODE -ne 0) { throw 'Probe quit failed; preserve the process for diagnosis' }
    if (-not $probeHost.WaitForExit(10000)) { throw 'Probe did not exit normally' }
}
$probeHost = Start-ProbeHost
try {
    if ($probeVariant.configDir) {
        & node.exe $probeInspector 9229 "$probePrefix-config-dir.json" config-dir $probeVariant.configDir
        if ($LASTEXITCODE -ne 0) { throw 'Fixture configDir selection failed' }
    }
    & node.exe $probeInspector 9229 "$probePrefix-enable.json" activate
    if ($LASTEXITCODE -ne 0) { throw 'Probe activation failed' }
} finally { Stop-ProbeHost $probeHost 'enable-quit' }
$probeHost = Start-ProbeHost
try {
    & node.exe $probeInspector 9229 "$probePrefix-startup.json"
    if ($LASTEXITCODE -ne 0) { throw 'Native startup report failed' }
} finally { Stop-ProbeHost $probeHost 'startup-quit' }
Write-Output "Report: $probePrefix-startup.json"
