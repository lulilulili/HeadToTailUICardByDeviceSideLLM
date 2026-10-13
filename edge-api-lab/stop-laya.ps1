$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'integrations/laya/process-utils.ps1')
$runtimePath = Join-Path $PSScriptRoot 'data/runtime'
$launcherPath = Join-Path $PSScriptRoot 'integrations/laya/server.py'
$venvPath = Join-Path $runtimePath 'laya-venv'
$record = Read-LayaProcessRecord $runtimePath $launcherPath $venvPath
$owned = @(Get-LayaOwnedProcesses $launcherPath $venvPath $record)
foreach ($process in ($owned | Sort-Object @{ Expression = { if ($owned.ProcessId -contains $_.ParentProcessId) { 0 } else { 1 } } })) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ProcessId)" -ErrorAction SilentlyContinue
    if ($current -and (Get-LayaCreationTime $current) -eq (Get-LayaCreationTime $process) -and (Get-LayaCanonicalPath $current.ExecutablePath) -eq (Get-LayaCanonicalPath $process.ExecutablePath) -and (Test-LayaScriptProcess $current $launcherPath)) {
        Stop-Process -Id $current.ProcessId -ErrorAction Stop
    }
}
if ($owned.Count -gt 0) {
    foreach ($name in @('laya-server.pid', 'laya-server-processes.json')) {
        $path = Join-Path $runtimePath $name
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
    }
    Write-Output '本项目 Laya 已停止。'
} else { Write-Output '没有找到经核验属于本项目的 Laya 进程；未停止其他服务。' }
