param([switch]$NewRun,[switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$projectPath = $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
& (Join-Path $projectPath 'launch.ps1') -NoOpen
$health = Invoke-RestMethod 'http://127.0.0.1:3210/api/health' -TimeoutSec 10
if ($health.lab.catalogVersion -ne 'single-service-v3') { throw '服务仍运行旧版本，请先用stop.ps1停止旧服务，再启动本工程。' }
if ($health.lab.exclusiveBenchmark) {
    Write-Output ('本轮测试已运行：' + $health.lab.exclusiveBenchmark.id)
    if (-not $NoOpen) { Start-Process 'http://127.0.0.1:3210/#evaluation' }
    exit 0
}
if ($health.queueDepth -ne 0 -or $health.activeJobs -ne 0) { throw '工作台还有推理或评测任务，请等待现有任务完成。' }
$pointerPath = Join-Path $projectPath 'data/runtime/single-service-100-active.json'
Set-Location -LiteralPath $projectPath
if ($NewRun -or -not (Test-Path -LiteralPath $pointerPath)) {
    & $nodePath 'scripts/benchmark-single-service-100.mjs' --new --initialize
    if ($LASTEXITCODE -ne 0) { throw '新批次初始化失败；没有启动后台推理。' }
}
$pointer = Get-Content -LiteralPath $pointerPath -Raw | ConvertFrom-Json
if ($pointer.id -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$' -or $pointer.manifestPath -ne ('data/runtime/single-service-100/' + $pointer.id + '/manifest.json')) { throw '当前批次指针不合法' }
$manifestFullPath = Join-Path $projectPath $pointer.manifestPath
$manifest = Get-Content -LiteralPath $manifestFullPath -Raw | ConvertFrom-Json
if ($manifest.id -ne $pointer.id) { throw '清单与当前批次不一致' }
if ($manifest.status -eq 'completed') {
    Write-Output '当前批次已经完成；重新测试请使用 start-full-test.ps1 -NewRun。'
    if (-not $NoOpen) { Start-Process 'http://127.0.0.1:3210/#evaluation' }
    exit 0
}
$runDirectory = Split-Path -Parent $manifestFullPath
$wrapperPath = Join-Path $projectPath 'scripts/run-full-benchmark.ps1'
$backgroundProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $wrapperPath + '"'),'-ManifestPath',('"' + $manifestFullPath + '"')) -WorkingDirectory $projectPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDirectory 'runner.log') -RedirectStandardError (Join-Path $runDirectory 'runner-error.log') -PassThru
$running = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 500
    $current = Get-Content -LiteralPath $manifestFullPath -Raw | ConvertFrom-Json
    if ($current.status -eq 'running' -and $current.runner.pid) { $running = $true; break }
    if ($backgroundProcess.HasExited -or $current.status -eq 'failed') { break }
}
if (-not $running) { throw ('后台测试未进入运行状态，请查看 ' + (Join-Path $runDirectory 'runner-error.log')) }
Write-Output ('已启动：' + $current.id + '，计划 ' + $current.conditions.totalCalls + ' 次；推理进程 ' + $current.runner.pid)
Write-Output ('测试日志：' + (Join-Path $runDirectory 'runner.log'))
if (-not $NoOpen) { Start-Process 'http://127.0.0.1:3210/#evaluation' }
