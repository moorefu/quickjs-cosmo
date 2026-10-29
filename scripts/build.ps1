param([switch]$Offline, [switch]$Nightly, [ValidateSet('base','full')][string]$RuntimeProfile = 'base', [string]$Distro = 'Ubuntu-22.04')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$linuxRoot = (& wsl.exe -d $Distro --exec wslpath -a $projectRoot).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve project path in WSL' }
$buildArgs = @('-d', $Distro, '--cd', $linuxRoot, '--exec', '/bin/sh', 'scripts/build.sh')
$buildArgs += '--' + $RuntimeProfile
if ($Offline) { $buildArgs += '--offline' }
if ($Nightly) { $buildArgs += '--nightly' }
& wsl.exe @buildArgs
if ($LASTEXITCODE -ne 0) { throw "WSL build failed: $LASTEXITCODE" }
