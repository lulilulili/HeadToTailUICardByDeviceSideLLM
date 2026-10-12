param([Parameter(Mandatory=$true)][string]$ManifestPath)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$manifestFullPath = [IO.Path]::GetFullPath($ManifestPath)
$batchDirectory = Join-Path $projectPath 'data/runtime/single-service-100'
if (-not $manifestFullPath.StartsWith(([IO.Path]::GetFullPath($batchDirectory) + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) { throw '测试清单必须在本工程批次目录内' }
$nodePath = (Get-Command node -ErrorAction Stop).Source
Set-Location -LiteralPath $projectPath
& $nodePath 'scripts/benchmark-single-service-100.mjs' --manifest $manifestFullPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodePath 'scripts/verify-single-service-100.mjs' --manifest $manifestFullPath --write-audit
exit $LASTEXITCODE
