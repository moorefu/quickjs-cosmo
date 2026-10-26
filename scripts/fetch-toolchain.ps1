#requires -Version 7.0
param([int]$Connections = 8)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $root '.cache'
New-Item -ItemType Directory -Force $cache | Out-Null
$lock = Get-Content (Join-Path $root 'versions.json') -Raw | ConvertFrom-Json
$url = $lock.cosmopolitan.url
$archivePath = Join-Path $cache 'cosmocc-4.0.2.zip'
if ((Test-Path $archivePath) -and
    (Get-FileHash $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $lock.cosmopolitan.sha256) {
    Write-Host "Verified cached toolchain: $archivePath"
    return
}
$size = 441763966L # Size of the official 4.0.2 GitHub release asset.
if ($Connections -lt 1 -or $Connections -gt 16) { throw 'Connections must be between 1 and 16' }
$proxyArgs = @()
$settings = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
if ($settings.ProxyEnable -eq 1 -and $settings.ProxyServer -match '^[^=;]+:\d+$') {
    $proxyArgs = @('--proxy', ('http://' + $settings.ProxyServer))
}
$chunkSize = [long][Math]::Ceiling($size / [double]$Connections)
$workers = @()
try {
    for ($i = 0; $i -lt $Connections; $i++) {
        $start = $i * $chunkSize
        $end = [Math]::Min($size - 1, $start + $chunkSize - 1)
        $part = Join-Path $cache "cosmocc-4.0.2.part-$i"
        $expectedSize = $end - $start + 1
        if ((Test-Path $part) -and (Get-Item $part).Length -eq $expectedSize) {
            continue
        }
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = 'curl.exe'
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        foreach ($argument in (@('--fail','--location','--retry','3','--connect-timeout','20',
                                '--silent','--show-error','--range',"$start-$end",'--output',$part) + $proxyArgs + @($url))) {
            $psi.ArgumentList.Add($argument)
        }
        $process = [System.Diagnostics.Process]::Start($psi)
        $workers += [PSCustomObject]@{ Process=$process; Part=$part; Size=$expectedSize }
    }
    foreach ($worker in $workers) {
        $worker.Process.WaitForExit()
        if ($worker.Process.ExitCode -ne 0 -or (Get-Item $worker.Part).Length -ne $worker.Size) {
            throw "Failed to download $($worker.Part)"
        }
        Write-Host ('Downloaded ' + (Split-Path -Leaf $worker.Part))
    }
    $temporary = Join-Path $cache 'cosmocc-4.0.2.zip.assembling'
    $output = [System.IO.File]::Create($temporary)
    try {
        for ($i = 0; $i -lt $Connections; $i++) {
            $inputStream = [System.IO.File]::OpenRead((Join-Path $cache "cosmocc-4.0.2.part-$i"))
            try { $inputStream.CopyTo($output) } finally { $inputStream.Dispose() }
        }
    } finally { $output.Dispose() }
    $actualHash = (Get-FileHash $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $lock.cosmopolitan.sha256) {
        throw "Toolchain SHA-256 mismatch: $actualHash"
    }
    Move-Item -LiteralPath $temporary -Destination $archivePath -Force
    for ($i = 0; $i -lt $Connections; $i++) {
        Remove-Item -LiteralPath (Join-Path $cache "cosmocc-4.0.2.part-$i")
    }
    Write-Host "SHA-256: $actualHash"
} finally {
    foreach ($worker in $workers) {
        if (-not $worker.Process.HasExited) { $worker.Process.Kill() }
        $worker.Process.Dispose()
    }
}
