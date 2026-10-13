param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$projectPath = $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
$sdkPath = Join-Path $projectPath 'node_modules/@typesafe-ai/sdk/package.json'
if (-not (Test-Path -LiteralPath $sdkPath)) {
    Write-Output '首次启动：安装已锁定的官方 Jev SDK（无需密钥）。'
    $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
    Push-Location -LiteralPath $projectPath
    try { & $npmPath ci --ignore-scripts; if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，请检查网络后重试。' } } finally { Pop-Location }
}
$serverUrl = 'http://127.0.0.1:3210'
$isRunning = $false
try { $response = Invoke-RestMethod "$serverUrl/api/health" -TimeoutSec 2; $isRunning = $response.lab.id -eq 'edge-api-lab' } catch {}
if (-not $isRunning) {
    $runtimePath = Join-Path $projectPath 'data/runtime'
    New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
    Start-Process -FilePath $nodePath -ArgumentList @('server.mjs') -WorkingDirectory $projectPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'server.log') -RedirectStandardError (Join-Path $runtimePath 'server-error.log')
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 300
        try { $response = Invoke-RestMethod "$serverUrl/api/health" -TimeoutSec 2; $isRunning = $response.lab.id -eq 'edge-api-lab'; if ($isRunning) { break } } catch {}
    }
}
if (-not $isRunning) { throw '服务启动失败，请查看 data/runtime/server-error.log' }
if (-not $NoOpen) { Start-Process $serverUrl }
if ($NoOpen) { Write-Output "实验服务已就绪：$serverUrl" } else { Write-Output "页面已打开：$serverUrl" }
