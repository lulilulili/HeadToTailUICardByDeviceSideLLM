param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$projectPath = $PSScriptRoot
. (Join-Path $projectPath 'integrations/laya/process-utils.ps1')
$runtimePath = Join-Path $projectPath 'data/runtime'
$venvPath = Join-Path $runtimePath 'laya-venv'
$pythonPath = Join-Path $venvPath 'Scripts/python.exe'
$modelCachePath = Join-Path $runtimePath 'laya-models'
$launcherPath = Join-Path $projectPath 'integrations/laya/server.py'
$requirementsPath = Join-Path $projectPath 'integrations/laya/requirements.txt'
$dependencyProbe = @'
import importlib.metadata as metadata
import pathlib, sys
canonical = lambda name: name.lower().replace('_', '-').replace('.', '-')
installed = {canonical(d.metadata['Name']): d.version for d in metadata.distributions() if d.metadata['Name']}
expected = [line.split('==', 1) for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines() if '==' in line and not line.startswith('#')]
sys.exit(0 if all(installed.get(canonical(name)) == version for name, version in expected) else 1)
'@
$pythonVersionProbe = 'import sys; sys.exit(0 if sys.version_info >= (3,12) and sys.version_info[:3] != (3,14,1) else 1)'
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null

function Start-LabLaya {
    $record = Read-LayaProcessRecord $runtimePath $launcherPath $venvPath
    $owned = @(Get-LayaOwnedProcesses $launcherPath $venvPath $record)
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        if ($listener.LocalAddress -ne '127.0.0.1' -or $listener.OwningProcess -notin $owned.ProcessId) {
            throw '8765 端口属于其他服务或工作目录；未安装、启动或停止任何进程。'
        }
    }
    if ($owned.Count -gt 0) {
        $listenerPid = if ($listeners.Count -gt 0) { [int]$listeners[0].OwningProcess } else { 0 }
        Save-LayaProcessRecord $runtimePath $launcherPath $venvPath $owned $listenerPid
        $ready = $false
        if ($listenerPid) {
            try { $status = Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 2; $ready = $status.status -eq 'ok' -and $status.loaded -contains 'multilingual' } catch {}
        }
        if ($ready) { Write-Output '本项目 Laya 多语言模型已就绪；复用已核验的监听进程。' }
        else { Write-Output '本项目的 Laya 正在加载，继续复用已有进程；请稍后在页面刷新状态。' }
        return
    }
    if (-not [string]::IsNullOrWhiteSpace($env:LAYA_API_KEY)) { throw 'LAYA_API_KEY：实验本机服务不用 key，请移除当前子进程配置中的该变量。' }
    if (-not (Test-Path -LiteralPath $pythonPath)) {
        $basePython = (Get-Command python -ErrorAction Stop).Source
        & $basePython -I -c $pythonVersionProbe
        if ($LASTEXITCODE -ne 0) { throw '锁定依赖需要 Python 3.12+（不含 3.14.1）；本机验证版本为 3.12.10。' }
        & $basePython -m venv $venvPath
        if ($LASTEXITCODE -ne 0) { throw '无法创建 Laya 的独立 Python 环境。' }
    }
    & $pythonPath -I -c $pythonVersionProbe
    if ($LASTEXITCODE -ne 0) { throw 'Laya 环境需要 Python 3.12+（不含 3.14.1），建议 Python 3.12.10。' }
    & $pythonPath -I -c $dependencyProbe $requirementsPath
    if ($LASTEXITCODE -ne 0) {
        Write-Output '安装已锁定的开源 Laya 依赖；首次安装需要联网。'
        & $pythonPath -m pip install -r $requirementsPath --disable-pip-version-check
        if ($LASTEXITCODE -ne 0) { throw 'Laya 依赖安装失败，请查看网络连接后重试。' }
        & $pythonPath -I -c $dependencyProbe $requirementsPath
        if ($LASTEXITCODE -ne 0) { throw '依赖版本与锁定清单不符，请查看安装输出。' }
    }
    & $pythonPath -m pip check --disable-pip-version-check
    if ($LASTEXITCODE -ne 0) { throw 'Laya 依赖存在不兼容项，请查看检查输出。' }
    # Configuration validation uses only stdlib; no model weights or FastAPI import.
    $previousPreference = $ErrorActionPreference
    try { $ErrorActionPreference = 'Continue'; $configurationResult = & $pythonPath -I $launcherPath --check-config 2>&1; $configurationExit = $LASTEXITCODE }
    finally { $ErrorActionPreference = $previousPreference }
    if ($configurationExit -ne 0) { throw ('Laya 子进程配置冲突：' + ($configurationResult -join ' ')) }
    $previousCache = [Environment]::GetEnvironmentVariable('HF_HUB_CACHE', 'Process')
    try {
        $env:HF_HUB_CACHE = $modelCachePath
        $layaProcess = Start-Process -FilePath $pythonPath -ArgumentList @('"' + $launcherPath + '"') -WorkingDirectory $projectPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'laya-server.log') -RedirectStandardError (Join-Path $runtimePath 'laya-server-error.log') -PassThru
    } finally { [Environment]::SetEnvironmentVariable('HF_HUB_CACHE', $previousCache, 'Process') }
    # The Windows venv executable may create a base-Python child that owns the socket.
    for ($attempt = 0; $attempt -lt 6; $attempt++) {
        Start-Sleep -Milliseconds 200
        $owned = @(Get-LayaOwnedProcesses $launcherPath $venvPath $null)
        if ($owned.Count -gt 1) { break }
        $layaProcess.Refresh()
        if ($layaProcess.HasExited) { break }
    }
    if ($owned.Count -eq 0) { throw 'Laya 启动后已退出或无法核验进程，请查看 data/runtime/laya-server-error.log。' }
    $listener = Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.OwningProcess -in $owned.ProcessId } | Select-Object -First 1
    $listenerPid = if ($listener) { [int]$listener.OwningProcess } else { 0 }
    Save-LayaProcessRecord $runtimePath $launcherPath $venvPath $owned $listenerPid
    Write-Output 'Laya 正在后台加载中文模型；首次会下载权重，无需 API Key 或云端充值。'
    Write-Output '下载进度和错误：data/runtime/laya-server-error.log。模型加载后，在实验页面刷新状态。'
}

$launchMutex = New-Object System.Threading.Mutex($false, 'Local\EdgeApiLabLaya8765')
$locked = $false
try {
    try { $locked = $launchMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw '另一个 Laya 启动器正在工作，请稍后重试。' }
    Start-LabLaya
} finally { if ($locked) { $launchMutex.ReleaseMutex() }; $launchMutex.Dispose() }
if (-not $NoOpen) { & (Join-Path $projectPath 'launch.ps1') }
