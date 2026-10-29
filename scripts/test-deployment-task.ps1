param(
    [string]$Python = (Get-Command python -ErrorAction Stop).Source,
    [string]$Qjs = "dist/qjs.exe",
    [string]$Compiled = "build/test-linux/deployment-standalone.exe",
    [string]$Sdk = "build/test-linux/deployment-sdk.exe",
    [string]$FsCompiled = "build/test-linux/host-filesystem-standalone.exe",
    [string]$FsSdk = "build/test-linux/host-filesystem-sdk.exe",
    [string]$UncRoot
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$taskName = 'quickjs-cosmo-acceptance-' + [guid]::NewGuid().ToString('N')
$directory = Join-Path $repository ('build/' + $taskName)
New-Item -ItemType Directory -Path $directory | Out-Null
$arguments = @((Join-Path $repository 'scripts/test_windows_deployment.py'), '--qjs', $Qjs, '--compiled', $Compiled, '--sdk', $Sdk, '--fs-compiled', $FsCompiled, '--fs-sdk', $FsSdk)
if ($UncRoot) { $arguments += @('--unc-root', $UncRoot) }
@{executable=$Python; arguments=$arguments; cwd=$repository} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $directory 'input.json') -Encoding UTF8
$runner = @'
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'input.json') -Raw | ConvertFrom-Json
Set-Location -LiteralPath $config.cwd
$env:PYTHONUTF8 = '1'
$ErrorActionPreference = 'Continue'
& $config.executable @($config.arguments) *> (Join-Path $PSScriptRoot 'console.log')
$code = $LASTEXITCODE
@{exitCode=$code; completed=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'result.json') -Encoding UTF8
exit $code
'@
$runnerPath = Join-Path $directory 'run.ps1'
$runner | Set-Content -LiteralPath $runnerPath -Encoding UTF8
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "' + $runnerPath + '"')
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -Hidden -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings | Out-Null
    Start-ScheduledTask -TaskName $taskName
    $deadline = (Get-Date).AddMinutes(5)
    $resultPath = Join-Path $directory 'result.json'
    while (-not (Test-Path -LiteralPath $resultPath)) {
        if ((Get-Date) -gt $deadline) { throw 'Scheduled acceptance timed out; inspect the retained console.log' }
        Start-Sleep -Milliseconds 250
    }
    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    if ($result.exitCode -ne 0) { throw ('Scheduled acceptance failed; inspect ' + $directory) }
    Write-Host ('PASS scheduled deployment acceptance; retained evidence: ' + $directory)
} finally {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
}
