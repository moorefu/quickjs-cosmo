param([switch]$Offline, [string]$Distro = 'Ubuntu-22.04')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$linuxRoot = (& wsl.exe -d $Distro --exec wslpath -a $projectRoot).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve project path in WSL' }
$buildArgs = @('-d', $Distro, '--cd', $linuxRoot, '--exec', '/bin/sh', 'scripts/build.sh')
if ($Offline) { $buildArgs += '--offline' }
& wsl.exe @buildArgs
if ($LASTEXITCODE -ne 0) { throw "WSL build failed: $LASTEXITCODE" }
