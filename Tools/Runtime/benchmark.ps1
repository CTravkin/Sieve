param([Parameter(Mandatory=$true)][string]$RunDirectory,[ValidateRange(5,20)][int]$Samples=5)
$ErrorActionPreference='Stop'
# This reuses already enabled fixture profiles with warm filesystem and metadata
# caches. It does not flush OS caches or claim an OS-cold startup measurement.
$sieveRun=(Resolve-Path -LiteralPath $RunDirectory).Path
foreach($sieveSample in 1..$Samples){
    foreach($sieveVariant in @('Baseline','Filtered')){
        & (Join-Path $PSScriptRoot 'run-desktop.ps1') -RunDirectory $sieveRun -Variant $sieveVariant -AlreadyEnabled
        if(-not $?){throw 'Native benchmark run failed'}
    }
}
& node.exe (Join-Path $PSScriptRoot 'summarize-benchmark.mjs') $sieveRun $Samples
if($LASTEXITCODE -ne 0){throw 'Benchmark evidence validation failed'}
