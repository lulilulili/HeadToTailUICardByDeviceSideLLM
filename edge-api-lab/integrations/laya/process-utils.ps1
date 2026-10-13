# Private launcher helpers. Every process is checked by exact script, executable and creation time.
function Get-LayaCanonicalPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    $value = $Path.Trim().Trim('"').Replace('/', '\')
    if (-not [IO.Path]::IsPathRooted($value)) { return $null }
    try { return [IO.Path]::GetFullPath($value).TrimEnd('\').ToLowerInvariant() } catch { return $null }
}

function Test-LayaScriptProcess {
    param($Process, [string]$LauncherPath)
    if (-not $Process -or $Process.Name -ne 'python.exe') { return $false }
    # Windows paths cannot contain quotes. Check the actual first script, never a later argument.
    $arguments = @([regex]::Matches([string]$Process.CommandLine, '"[^"]*"|[^\s]+') | ForEach-Object { $_.Value.Trim('"') })
    if ($arguments.Count -lt 2) { return $false }
    $index = 1
    while ($index -lt $arguments.Count -and $arguments[$index] -in @('-u', '-I', '-B', '-E', '-s', '-S')) { $index++ }
    if ($index -ge $arguments.Count) { return $false }
    $script = Get-LayaCanonicalPath $arguments[$index]
    return $script -and $script -eq (Get-LayaCanonicalPath $LauncherPath)
}

function Get-LayaCreationTime {
    param($Process)
    try { return ([datetime]$Process.CreationDate).ToUniversalTime().ToString('o') } catch { return '' }
}

function Read-LayaProcessRecord {
    param([string]$RuntimePath, [string]$LauncherPath, [string]$VenvPath)
    $path = Join-Path $RuntimePath 'laya-server-processes.json'
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try {
        $record = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($record.version -eq 1 -and (Get-LayaCanonicalPath $record.launcherPath) -eq (Get-LayaCanonicalPath $LauncherPath) -and (Get-LayaCanonicalPath $record.venvPath) -eq (Get-LayaCanonicalPath $VenvPath)) { return $record }
    } catch {}
    return $null
}

function Get-LayaOwnedProcesses {
    param([string]$LauncherPath, [string]$VenvPath, $Record)
    $all = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue)
    $venvExecutable = Get-LayaCanonicalPath (Join-Path $VenvPath 'Scripts/python.exe')
    $baseExecutable = $null
    $config = Join-Path $VenvPath 'pyvenv.cfg'
    if (Test-Path -LiteralPath $config) {
        $homeLine = Get-Content -LiteralPath $config | Where-Object { $_ -match '^home\s*=' } | Select-Object -First 1
        if ($homeLine) { $baseExecutable = Get-LayaCanonicalPath (Join-Path (($homeLine -split '=', 2)[1].Trim()) 'python.exe') }
    }
    $owned = @()
    foreach ($process in $all) {
        if (-not (Test-LayaScriptProcess $process $LauncherPath)) { continue }
        $saved = @($Record.processes | Where-Object { $_.pid -eq $process.ProcessId })
        if ($saved.Count -gt 0 -and $saved[0].creationTime -ne (Get-LayaCreationTime $process)) { continue }
        if ((Get-LayaCanonicalPath $process.ExecutablePath) -eq $venvExecutable) { $owned += $process }
    }
    foreach ($process in $all) {
        if (-not $baseExecutable -or (Get-LayaCanonicalPath $process.ExecutablePath) -ne $baseExecutable -or -not (Test-LayaScriptProcess $process $LauncherPath)) { continue }
        $saved = @($Record.processes | Where-Object { $_.pid -eq $process.ProcessId })
        $attested = $saved.Count -gt 0 -and $saved[0].creationTime -eq (Get-LayaCreationTime $process) -and (Get-LayaCanonicalPath $saved[0].executablePath) -eq $baseExecutable
        if (($owned.ProcessId -contains $process.ParentProcessId) -or $attested) { $owned += $process }
    }
    return $owned
}

function Save-LayaProcessRecord {
    param([string]$RuntimePath, [string]$LauncherPath, [string]$VenvPath, [array]$Processes, [int]$ListenerPid = 0)
    if ($Processes.Count -eq 0) { return }
    $record = [ordered]@{ version = 1; launcherPath = $LauncherPath; venvPath = $VenvPath; listenerPid = $ListenerPid; processes = @($Processes | ForEach-Object {
        [ordered]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; creationTime = Get-LayaCreationTime $_; executablePath = $_.ExecutablePath }
    }) }
    $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $RuntimePath 'laya-server-processes.json') -Encoding UTF8
    $savedPid = if ($ListenerPid) { $ListenerPid } else { [int]$Processes[0].ProcessId }
    Set-Content -LiteralPath (Join-Path $RuntimePath 'laya-server.pid') -Value $savedPid
}
