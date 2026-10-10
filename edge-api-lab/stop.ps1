$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot 'data/runtime/server.pid'
if (Test-Path -LiteralPath $pidFile) {
    $labProcessId = [int](Get-Content -LiteralPath $pidFile)
    $labProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $labProcessId"
    if ($labProcess -and $labProcess.Name -eq 'node.exe' -and $labProcess.CommandLine -match 'server\.mjs') {
        $connection = Get-NetTCPConnection -State Listen -LocalPort 3210 -ErrorAction SilentlyContinue
        if ($connection -and $connection.OwningProcess -eq $labProcessId) { Stop-Process -Id $labProcessId; Write-Output '实验服务已停止。' }
    }
}
