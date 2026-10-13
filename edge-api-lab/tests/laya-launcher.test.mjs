import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = existsSync('D:/08_智能生成业务/edge-api-lab/data/runtime/laya-venv/Scripts/python.exe')
  ? 'D:/08_智能生成业务/edge-api-lab/data/runtime/laya-venv/Scripts/python.exe' : 'python';
const psQuote = value => `'${value.replaceAll("'", "''")}'`;

function purePython(code) {
  const source = join(project, 'integrations/laya/server.py');
  const prefix = `import ast, os, json\nsource=ast.parse(open(${JSON.stringify(source)},encoding='utf-8').read())\nallowed=[]\nfor node in source.body:\n if isinstance(node,ast.FunctionDef): allowed.append(node)\n elif isinstance(node,ast.Assign) and all(isinstance(t,ast.Name) and t.id in ('DEFAULTS','REQUEST_DEFAULTS') for t in node.targets): allowed.append(node)\nexec(compile(ast.Module(body=allowed,type_ignores=[]),'<configuration-only>','exec'))\n`;
  return spawnSync(python, ['-I', '-c', prefix + code], { encoding: 'utf8', windowsHide: true });
}

test('managed Laya rejects conflicting child settings before any defaults are changed', () => {
  const result = purePython(`assert 'configure_runtime_environment' in globals(), 'missing validated runtime configuration'\nfor name,value in [('LAYA_API_KEY','secret-do-not-echo'),('LAYA_DEVICE','cuda'),('LAYA_PRELOAD','0'),('LAYA_TOURNAMENT_GROUP','1'),('LAYA_REVISION','other')]:\n env={name:value}; before=env.copy()\n try: configure_runtime_environment(env)\n except ValueError as error:\n  assert name in str(error)\n  assert value not in str(error) if name=='LAYA_API_KEY' else True\n else: raise AssertionError('conflict was accepted: '+name)\n assert env==before, 'failed validation partially mutated environment'\nprint('ok')\n`);
  assert.equal(result.status, 0, result.stderr);
});

test('managed health labels fixed request budgets separately from native defaults', () => {
  const result = purePython(`assert 'configure_runtime_environment' in globals() and 'deployment_facts' in globals(), 'missing configuration facts'\nenv={}\nconfigure_runtime_environment(env)\nfacts=deployment_facts(env,'0.4.6')\nassert env['LAYA_DEVICE']=='cpu' and env['LAYA_THREADS']=='8'\nassert facts['tournamentGroup']==16 and facts['maxChoices']==255\nassert facts['maxLen']==4096 and facts['headMaxLen']==768\nassert facts['budgetRole']=='client-request-profile'\nassert facts['modelRevision']=='7b928d828b7b0e022f929d9bd2e44165aa270148'\nprint('ok')\n`);
  assert.equal(result.status, 0, result.stderr);
});

function stopFixture({ foreign = false, stale = false, setup = false, loading = false } = {}) {
  const temporary = mkdtempSync(join(tmpdir(), 'edge-laya-launcher-'));
  try {
    const runtime = join(temporary, 'data/runtime');
    const integration = join(temporary, 'integrations/laya');
    const venv = join(runtime, 'laya-venv');
    mkdirSync(join(venv, 'Scripts'), { recursive: true }); mkdirSync(integration, { recursive: true });
    // Decode existing UTF-8 explicitly for the behavior fixture; a separate test checks PS5 file encoding.
    for (const file of ['stop-laya.ps1', 'setup-laya.ps1']) writeFileSync(join(temporary, file), '\uFEFF' + readFileSync(join(project, file), 'utf8').replace(/^\uFEFF/, ''));
    if (existsSync(join(project, 'integrations/laya/process-utils.ps1'))) copyFileSync(join(project, 'integrations/laya/process-utils.ps1'), join(integration, 'process-utils.ps1'));
    const launcher = join(integration, 'server.py'); writeFileSync(launcher, '');
    writeFileSync(join(venv, 'Scripts/python.exe'), 'not an executable; reuse must not install or run Python');
    const base = join(temporary, 'base-python'); mkdirSync(base);
    writeFileSync(join(venv, 'pyvenv.cfg'), `home = ${base}\n`);
    const command = `"${join(venv, 'Scripts/python.exe')}" "${launcher.replaceAll('\\', '/')}"`;
    const processes = foreign ? [{ ProcessId: 303, ParentProcessId: 0, Name: 'python.exe', ExecutablePath: join(venv, 'Scripts/python.exe'), CommandLine: `"${join(venv, 'Scripts/python.exe')}" "${join(temporary, 'foreign.py')}" "${launcher}"`, CreationDate: '2026-10-13T00:00:00Z' }] : [
      { ProcessId: 101, ParentProcessId: 0, Name: 'python.exe', ExecutablePath: join(venv, 'Scripts/python.exe'), CommandLine: command, CreationDate: '2026-10-13T00:00:00Z' },
      { ProcessId: 202, ParentProcessId: 101, Name: 'python.exe', ExecutablePath: join(base, 'python.exe'), CommandLine: command, CreationDate: '2026-10-13T00:00:01Z' },
      { ProcessId: 404, ParentProcessId: 101, Name: 'python.exe', ExecutablePath: join(base, 'python.exe'), CommandLine: `python.exe "${join(temporary, 'unrelated.py')}"`, CreationDate: '2026-10-13T00:00:02Z' },
    ];
    writeFileSync(join(runtime, 'laya-server.pid'), String(foreign ? 303 : 101));
    if (stale) writeFileSync(join(runtime, 'laya-server-processes.json'), JSON.stringify({ version: 1, launcherPath: launcher, venvPath: venv, processes: [{ pid: 101, executablePath: processes[0].ExecutablePath, creationTime: '2026-10-12T00:00:00.0000000Z' }] }));
    const script = `$ErrorActionPreference='Stop'\n$global:fixtures=${psQuote(JSON.stringify(processes))} | ConvertFrom-Json\n$global:stops=New-Object System.Collections.Generic.List[int]\nfunction global:Get-CimInstance { param($ClassName,$Filter,$ErrorAction) if($Filter -match 'ProcessId\\s*=\\s*(\\d+)'){ $findPid=[int]$matches[1]; return @($global:fixtures | Where-Object ProcessId -eq $findPid) }; return $global:fixtures }\nfunction global:Get-NetTCPConnection { param($State,$LocalPort,$ErrorAction) return @([pscustomobject]@{OwningProcess=${foreign ? 303 : 202};LocalAddress='127.0.0.1';LocalPort=8765}) }\nfunction global:Stop-Process { param([int]$Id,$ErrorAction) if($Id -notin @(101,202,303,404)){ throw 'unexpected real process access' }; $global:stops.Add($Id); $global:fixtures=@($global:fixtures | Where-Object ProcessId -ne $Id) }\n& ${psQuote(join(temporary, 'stop-laya.ps1'))} | Out-Null\nWrite-Output ('RESULT:' + (ConvertTo-Json -InputObject @($global:stops.ToArray()) -Compress))\n`;
    const actualScript = setup ? script.replace(`& ${psQuote(join(temporary, 'stop-laya.ps1'))} | Out-Null`, `function global:Start-Process { throw 'duplicate process or installation attempted' }\nfunction global:Invoke-RestMethod { param($Uri,$TimeoutSec) ${loading ? "throw 'still loading'" : "return [pscustomobject]@{status='ok';loaded=@('multilingual')}"} }\n${loading ? 'function global:Get-NetTCPConnection { return @() }' : ''}\n& ${psQuote(join(temporary, 'setup-laya.ps1'))} -NoOpen | Out-Null`) : script;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', actualScript], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const match = result.stdout.match(/RESULT:(\[[^\r\n]*\])/); assert.ok(match, result.stdout);
    const stopped = JSON.parse(match[1]);
    if (setup) {
      const record = JSON.parse(readFileSync(join(runtime, 'laya-server-processes.json'), 'utf8').replace(/^\uFEFF/, ''));
      assert.equal(record.listenerPid, loading ? 0 : 202);
      assert.deepEqual(record.processes.map(row => row.pid), [101, 202]);
      assert.equal(Number(readFileSync(join(runtime, 'laya-server.pid'), 'utf8').trim()), loading ? 101 : 202);
    }
    return stopped;
  } finally {
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir())) && dirname(temporary) === resolve(tmpdir()));
    rmSync(temporary, { recursive: true, force: true });
  }
}

test('stop verifies normalized exact script and stops Python listener child before its venv parent', () => {
  assert.deepEqual(stopFixture(), [202, 101]);
});
test('stop refuses an owned script appearing only as an argument to a foreign script', () => {
  assert.deepEqual(stopFixture({ foreign: true }), []);
});
test('stop refuses reused PID whose recorded creation time no longer matches', () => {
  assert.deepEqual(stopFixture({ stale: true }), []);
});

test('setup reuses verified healthy listener before installation and records actual child PID', () => {
  assert.deepEqual(stopFixture({ setup: true }), []);
});
test('setup reuses verified loading parent rather than starting a duplicate service', () => {
  assert.deepEqual(stopFixture({ setup: true, loading: true }), []);
});

test('missing package probe exits cleanly without Python traceback under PowerShell 5', () => {
  const source = readFileSync(join(project, 'setup-laya.ps1'), 'utf8');
  const probe = source.match(/\$dependencyProbe\s*=\s*@'\r?\n([\s\S]*?)\r?\n'@/);
  assert.ok(probe, 'missing traceback-free dependency probe');
  const result = spawnSync(python, ['-I', '-c', `import importlib.metadata\nimportlib.metadata.distributions=lambda: []\n${probe[1]}`, join(project, 'integrations/laya/requirements.txt')], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
});

test('Chinese PowerShell launchers use UTF-8 BOM for native Windows PowerShell 5 parsing', () => {
  for (const file of ['setup-laya.ps1', 'stop-laya.ps1']) {
    const bytes = readFileSync(join(project, file));
    assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191], `${file} needs UTF-8 BOM`);
  }
});
