param(
    [Parameter(Mandatory=$true)][string]$RunDirectory,
    [Parameter(Mandatory=$true)][string]$ExpectedIdentityPath,
    [ValidateRange(5,20)][int]$Samples=5,
    [ValidateRange(1000,20000)][int]$NewTechnicalFiles=10000,
    [ValidateRange(10,180)][int]$MetadataTimeoutSeconds=90,
    [string]$ObsidianPath="$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe"
)
$ErrorActionPreference='Stop'
# Full app restarts in ONE already trusted profile. Sieve stays enabled.
# Offline census warms OS caches; metadata caches are retained. No trust automation.
$sievePhaseTool=Join-Path $PSScriptRoot 'benchmark-phase.mjs'
$sieveNativeTool=Join-Path $PSScriptRoot 'benchmark-native.mjs'
$sieveHost=$null
$sieveRestoreRequired=$false
$sieveQuitNumber=0
$sievePhase=$null
function Write-SieveJsonEvidence([string]$Target,$Value) {
    $sieveJson=$Value | ConvertTo-Json -Depth 8
    $sieveStream=[IO.File]::Open($Target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {
        $sieveWriter=New-Object IO.StreamWriter($sieveStream,(New-Object Text.UTF8Encoding($false)))
        try {$sieveWriter.WriteLine($sieveJson)} finally {$sieveWriter.Dispose()}
    } finally {$sieveStream.Dispose()}
}
function Assert-SieveClosed {
    if (@(Get-CimInstance Win32_Process -Filter "Name = 'Obsidian.exe'").Count -ne 0) { throw 'Preserve preexisting Obsidian processes' }
    if (Get-NetTCPConnection -LocalPort 9229 -State Listen -ErrorAction SilentlyContinue) { throw 'Debugger port 9229 is in use' }
}
function Invoke-SieveNative([string]$Action,[string]$Output,[string]$Mode='-',[int]$Pair=0) {
    $sieveResult=& node.exe $sieveNativeTool $sievePhase $Action $Output $Mode $Pair ($MetadataTimeoutSeconds*1000) $sieveHost.SieveQuitBindingBase64
    if($LASTEXITCODE -ne 0){throw "Benchmark native $Action failed; preserve evidence"}
    return ($sieveResult | ConvertFrom-Json)
}
function Start-SieveBenchmarkHost([string]$Tag) {
    Assert-SieveClosed
    $sieveLaunchContext=& node.exe $sievePhaseTool launch-context $sievePhase $ObsidianPath
    if($LASTEXITCODE -ne 0){throw 'Exact physical fixture/package preflight failed before launch'}
    $sieveDefinition=$sieveLaunchContext | ConvertFrom-Json
    # Snapshot verified paths and a unique process nonce before Start-Process.
    $sieveLaunchId=[Guid]::NewGuid().ToString()
    $sieveExecutable=$sieveDefinition.executablePath
    $sieveArguments=@(('--user-data-dir="'+$sieveDefinition.profile+'"'),'--remote-debugging-address=127.0.0.1','--remote-debugging-port=9229',"--sieve-benchmark-launch=$sieveLaunchId")
    $sieveProcess=Start-Process -FilePath $sieveExecutable -ArgumentList $sieveArguments -WindowStyle Hidden -PassThru
    $script:sieveHost=$sieveProcess
    $sieveProcess | Add-Member -NotePropertyName SieveTag -NotePropertyValue $Tag
    $sieveBinding=[pscustomobject]@{schemaVersion=1;phaseId=$sieveDefinition.phaseId;launchId=$sieveLaunchId;run=$sieveDefinition.run;vault=$sieveDefinition.vault;profile=$sieveDefinition.profile;physicalProfile=$sieveDefinition.physicalProfile;configDir=$sieveDefinition.configDir;pid=$sieveProcess.Id;port=9229;executablePath=$sieveExecutable;startFileTimeUtc=$sieveProcess.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();startedUtc=$sieveProcess.StartTime.ToUniversalTime().ToString('o')}
    $sieveCapturedJson=$sieveBinding | ConvertTo-Json -Compress
    $sieveCapturedBase64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sieveCapturedJson))
    # This immutable string stays in controller memory, never reloaded from evidence.
    $sieveProcess | Add-Member -NotePropertyName SieveQuitBindingBase64 -NotePropertyValue $sieveCapturedBase64
    Write-SieveJsonEvidence (Join-Path $sievePhase "$Tag-process.json") ([pscustomobject]@{launchBinding=$sieveBinding;arguments=$sieveArguments;launchedAtUtc=[DateTime]::UtcNow.ToString('o')})
    return $sieveProcess
}
function Stop-SieveBenchmarkHost($Process) {
    $script:sieveQuitNumber++
    if($Process.HasExited){return}
    $sieveQuitResult=& node.exe $sieveNativeTool quit-owned $Process.SieveQuitBindingBase64
    $sieveQuitExitCode=$LASTEXITCODE
    # A failed evidence write/inspection never skips the normal-exit wait.
    $sieveExited=$Process.WaitForExit(10000)
    if($sieveQuitExitCode -ne 0 -or -not $sieveExited){throw 'Owned normal quit failed; preserve processes and evidence, no forced termination'}
    if($sieveQuitResult){
        Write-SieveJsonEvidence (Join-Path $sievePhase "$($Process.SieveTag)-quit-$script:sieveQuitNumber.json") ($sieveQuitResult | ConvertFrom-Json)
    }
}
function Get-SieveMonotonicNs {
    return [decimal]::Truncate([decimal][Diagnostics.Stopwatch]::GetTimestamp()*1000000000/[Diagnostics.Stopwatch]::Frequency).ToString('0',[Globalization.CultureInfo]::InvariantCulture)
}
function Save-SieveProcessMetrics([string]$Stem,$Observation) {
    $sieveSnapshotStartedUtc=[DateTime]::UtcNow.ToString('o')
    $sieveSnapshotStartedNs=Get-SieveMonotonicNs
    if($Observation.launchBinding.pid -ne $sieveHost.Id){throw 'Resource snapshot launch binding mismatch'}
    # Existing app was refused before launch. Restrict snapshots to its PID tree.
    $sieveWinProcesses=@(Get-CimInstance Win32_Process -Filter "Name = 'Obsidian.exe'")
    $sieveOwned=@($sieveHost.Id)
    do {
        $sievePreviousCount=$sieveOwned.Count
        foreach($sieveRow in $sieveWinProcesses){if($sieveOwned -contains $sieveRow.ParentProcessId -and $sieveOwned -notcontains $sieveRow.ProcessId){$sieveOwned+=[int]$sieveRow.ProcessId}}
    } while($sieveOwned.Count -ne $sievePreviousCount)
    if(@($sieveWinProcesses | Where-Object {$sieveOwned -notcontains $_.ProcessId}).Count -ne 0){throw 'Unrelated Obsidian process appeared during measurement'}
    $sieveRows=@($sieveWinProcesses | ForEach-Object {
        $sieveProcess=Get-Process -Id $_.ProcessId -ErrorAction Stop
        [pscustomobject]@{pid=$sieveProcess.Id;parentPid=[int]$_.ParentProcessId;startFileTimeUtc=$sieveProcess.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();cpuSeconds=$sieveProcess.CPU;workingSetBytes=$sieveProcess.WorkingSet64;peakWorkingSetBytes=$sieveProcess.PeakWorkingSet64}
    })
    if($sieveRows.Count -eq 0){throw 'No owned native processes at metrics snapshot'}
    $sieveSnapshotFinishedNs=Get-SieveMonotonicNs
    $sieveSnapshotFinishedUtc=[DateTime]::UtcNow.ToString('o')
    Write-SieveJsonEvidence (Join-Path $sievePhase "Measurements\$Stem-process-metrics.json") ([pscustomobject]@{phaseId=$Observation.phaseId;pair=$Observation.pair;mode=$Observation.mode;sampleKind=$Observation.sampleKind;reportIdentity=$Observation.reportIdentity;identityDigest=$Observation.identityDigest;launchPid=$Observation.launchBinding.pid;launchId=$Observation.launchBinding.launchId;metadataCompletionUtc=$Observation.metadataCompletion.utc;metadataCompletionMonotonicNs=$Observation.metadataCompletion.monotonicNs;measuredAfterMetadata=$true;snapshotStartedUtc=$sieveSnapshotStartedUtc;snapshotFinishedUtc=$sieveSnapshotFinishedUtc;snapshotStartedMonotonicNs=$sieveSnapshotStartedNs;snapshotFinishedMonotonicNs=$sieveSnapshotFinishedNs;deltaFromMetadataMs=[double](([decimal]$sieveSnapshotStartedNs-[decimal]$Observation.metadataCompletion.monotonicNs)/1000000);snapshotDurationMs=[double](([decimal]$sieveSnapshotFinishedNs-[decimal]$sieveSnapshotStartedNs)/1000000);processes=$sieveRows;cpuSeconds=($sieveRows | Measure-Object cpuSeconds -Sum).Sum;workingSetBytes=($sieveRows | Measure-Object workingSetBytes -Sum).Sum;aggregateProcessPeakWorkingSetBytes=($sieveRows | Measure-Object peakWorkingSetBytes -Sum).Sum})
}
function Observe-SieveBenchmarkSample([string]$Stem,[string]$Mode,[int]$Pair) {
    try {
        $sieveObservation=Invoke-SieveNative 'report' (Join-Path $sievePhase "Measurements\$Stem-startup.json") $Mode $Pair
        Save-SieveProcessMetrics $Stem $sieveObservation
        if($Mode -eq 'Baseline'){$null=Invoke-SieveNative 'save' (Join-Path $sievePhase "$Stem-next-save.json") 'Filtered'}
        elseif($Pair -lt $Samples){$null=Invoke-SieveNative 'save' (Join-Path $sievePhase "$Stem-next-save.json") 'Baseline'}
        else {$null=Invoke-SieveNative 'restore' (Join-Path $sievePhase 'restore.json');$script:sieveRestoreRequired=$false}
    } finally {if($sieveHost){Stop-SieveBenchmarkHost $sieveHost;$script:sieveHost=$null}}
    # Full source hashing is strictly after resource snapshot and normal quit.
    & node.exe $sievePhaseTool complete-sample $sievePhase $Stem
    if($LASTEXITCODE -ne 0){throw 'Post-quit corpus/sample validation failed'}
}
Assert-SieveClosed
$sievePhase=& node.exe $sievePhaseTool init $RunDirectory $ExpectedIdentityPath $Samples $NewTechnicalFiles
if($LASTEXITCODE -ne 0){throw 'Benchmark preparation failed before native launch'}
$sievePhase=[string]$sievePhase
Write-Output "Benchmark phase: $sievePhase"
try {
    $sieveHost=Start-SieveBenchmarkHost 'preflight'
    try {Invoke-SieveNative 'preflight' (Join-Path $sievePhase 'preflight.json')}
    finally {if($sieveHost){Stop-SieveBenchmarkHost $sieveHost;$sieveHost=$null}}
    Assert-SieveClosed
    & node.exe $sievePhaseTool extend $sievePhase
    if($LASTEXITCODE -ne 0){throw 'Synthetic source extension failed; phase evidence preserved'}
    $sieveHost=Start-SieveBenchmarkHost 'prepare-baseline'
    # Set this before save, so a partial API write also invokes restoration.
    $sieveRestoreRequired=$true
    try {Invoke-SieveNative 'save' (Join-Path $sievePhase 'prepare-baseline-save.json') 'Baseline'}
    finally {if($sieveHost){Stop-SieveBenchmarkHost $sieveHost;$sieveHost=$null}}
    # Warm each mode once after corpus extension. These reports cannot enter
    # the exact Measurements inventory used by the final summary.
    foreach($sieveWarmMode in @('Baseline','Filtered')){
        Assert-SieveClosed
        & node.exe $sievePhaseTool verify $sievePhase
        if($LASTEXITCODE -ne 0){throw 'Source/package verification failed before warm-up'}
        $sieveHost=Start-SieveBenchmarkHost "warmup-$sieveWarmMode"
        try {
            Invoke-SieveNative 'report' (Join-Path $sievePhase "warmup-$sieveWarmMode-startup.json") $sieveWarmMode 1
            $sieveNextMode=if($sieveWarmMode -eq 'Baseline'){'Filtered'}else{'Baseline'}
            Invoke-SieveNative 'save' (Join-Path $sievePhase "warmup-$sieveWarmMode-next-save.json") $sieveNextMode
        } finally {if($sieveHost){Stop-SieveBenchmarkHost $sieveHost;$sieveHost=$null}}
    }
    foreach($sievePair in 1..$Samples){
        foreach($sieveMode in @('Baseline','Filtered')){
            Assert-SieveClosed
            & node.exe $sievePhaseTool verify $sievePhase
            if($LASTEXITCODE -ne 0){throw 'Source/package pre-start verification failed'}
            $sieveStem=('{0:D2}-{1}' -f $sievePair,$sieveMode)
            $sieveHost=Start-SieveBenchmarkHost $sieveStem
            Observe-SieveBenchmarkSample $sieveStem $sieveMode $sievePair
        }
    }
} finally {
    if($sieveRestoreRequired){
        if(-not $sieveHost){Assert-SieveClosed;$sieveHost=Start-SieveBenchmarkHost 'recovery'}
        try {Invoke-SieveNative 'restore' (Join-Path $sievePhase 'recovery-restore.json');$sieveRestoreRequired=$false}
        finally {if($sieveHost){Stop-SieveBenchmarkHost $sieveHost;$sieveHost=$null}}
    } elseif($sieveHost){Stop-SieveBenchmarkHost $sieveHost;$sieveHost=$null}
}
Assert-SieveClosed
$sieveHost=Start-SieveBenchmarkHost 'restore-confirmation'
try {$null=Invoke-SieveNative 'confirm-restore' (Join-Path $sievePhase 'restore-confirmation.json')}
finally {if($sieveHost){Stop-SieveBenchmarkHost $sieveHost;$sieveHost=$null}}
Assert-SieveClosed
& node.exe $sievePhaseTool finalize $sievePhase
if($LASTEXITCODE -ne 0){throw 'Benchmark evidence validation failed; no PASS summary'}
