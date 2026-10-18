param([int]$Port = 8788)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js 22 or newer is required.' }
$env:GPT_PORT = [string]$Port
& $nodePath (Join-Path $PSScriptRoot 'src\server.mjs')
exit $LASTEXITCODE
