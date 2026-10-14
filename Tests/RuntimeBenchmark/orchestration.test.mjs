import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

function runContract(failure='') {
  // Execute the actual PS observation function with mocked seams. The script's
  // top-level launch/main body is not evaluated and no native/file writes occur.
  const script=String.raw`
    $sieveTokens=$null;$sieveErrors=$null;
    $sieveAst=[System.Management.Automation.Language.Parser]::ParseFile($env:SIEVE_BENCHMARK_TEST_SCRIPT,[ref]$sieveTokens,[ref]$sieveErrors);
    if($sieveErrors.Count){throw 'Script parse failed'};
    $sieveFunction=$sieveAst.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Observe-SieveBenchmarkSample'},$true);
    if($sieveFunction.Count -ne 1){throw 'Actual observation seam missing'};
    Invoke-Expression $sieveFunction[0].Extent.Text;
    $script:sieveCalls=New-Object 'System.Collections.Generic.List[string]';
    $sievePhase='C:\owned-phase';$sievePhaseTool='phase-tool';$sieveHost=[pscustomobject]@{Id=42};$Samples=5;$sieveRestoreRequired=$true;
    function Invoke-SieveNative([string]$Action,[string]$Output,[string]$Mode,[int]$Pair){
      if($Action -eq 'report'){$script:sieveCalls.Add('metadata-report');return [pscustomobject]@{phaseId='owned';pair=$Pair;mode=$Mode;launchBinding=[pscustomobject]@{pid=42};metadataCompletion=[pscustomobject]@{clean=$true}}};
      $script:sieveCalls.Add($Action);
    }
    function Save-SieveProcessMetrics([string]$Stem,$Observation){if($Observation.launchBinding.pid -ne 42 -or -not $Observation.metadataCompletion.clean){throw 'Wrong observation received'};$script:sieveCalls.Add('resource-snapshot');if($env:SIEVE_BENCHMARK_TEST_FAILURE -eq 'metrics'){throw 'Injected resource failure'}}
    function Stop-SieveBenchmarkHost($Process){$script:sieveCalls.Add('normal-quit')}
    function node.exe([string]$Tool,[string]$Action,[string]$Directory,[string]$Stem){if($Tool -ne 'phase-tool' -or $Action -ne 'complete-sample' -or $script:sieveHost){throw 'Census inside app observation window'};$script:sieveCalls.Add('post-quit-census');$global:LASTEXITCODE=0}
    $sieveCaught=$null;try{Observe-SieveBenchmarkSample '01-Baseline' 'Baseline' 1}catch{$sieveCaught=$_.Exception.Message};
    [pscustomobject]@{calls=@($script:sieveCalls);caught=$sieveCaught} | ConvertTo-Json -Compress
  `;
  return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:10000,windowsHide:true,env:{...process.env,SIEVE_BENCHMARK_TEST_SCRIPT:fileURLToPath(new URL('../../Tools/Runtime/benchmark-same-vault.ps1',import.meta.url)),SIEVE_BENCHMARK_TEST_FAILURE:failure}}));
}
test('actual orchestration takes resource snapshot before save/normal quit and post-quit census',{skip:process.platform!=='win32'},()=>{
  const result=runContract();assert.equal(result.caught,null);assert.deepEqual(result.calls,['metadata-report','resource-snapshot','save','normal-quit','post-quit-census']);
});
test('resource failure still attempts normal quit and cannot run census inside the window',{skip:process.platform!=='win32'},()=>{
  const result=runContract('metrics');assert.match(result.caught,/resource failure/);assert.deepEqual(result.calls,['metadata-report','resource-snapshot','normal-quit']);
});
