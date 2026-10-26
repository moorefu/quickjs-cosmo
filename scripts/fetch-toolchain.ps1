#requires -Version 7.0
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $root '.cache'
New-Item -ItemType Directory -Force $cache | Out-Null
$lock = Get-Content (Join-Path $root 'versions.json') -Raw | ConvertFrom-Json
$cosmo = $lock.cosmopolitan
$archivePath = Join-Path $cache $cosmo.archive_name
if ((Test-Path -LiteralPath $archivePath) -and
    (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $cosmo.sha256) {
    Write-Host "Verified cached toolchain: $archivePath"
    return
}
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    throw "Download the cosmocc artifact from $($cosmo.run_url) to $archivePath, or install and authenticate GitHub CLI (gh)."
}
$temporary = "$archivePath.part"
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $gh.Source
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.ArgumentList.Add('api')
$psi.ArgumentList.Add("repos/jart/cosmopolitan/actions/artifacts/$($cosmo.artifact_id)/zip")
$settings = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
if ($settings.ProxyEnable -eq 1 -and $settings.ProxyServer -match '^[^=;]+:\d+$') {
    $psi.Environment['HTTPS_PROXY'] = 'http://' + $settings.ProxyServer
}
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $psi
try {
    if (-not $process.Start()) { throw 'Could not start GitHub CLI' }
    $output = [System.IO.File]::Create($temporary)
    try { $process.StandardOutput.BaseStream.CopyTo($output) } finally { $output.Dispose() }
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "GitHub artifact download failed: $($process.ExitCode)" }
    $actualHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $cosmo.sha256) { throw "Toolchain SHA-256 mismatch: $actualHash" }
    Move-Item -LiteralPath $temporary -Destination $archivePath -Force
    Write-Host "SHA-256: $actualHash"
} finally {
    $process.Dispose()
}
