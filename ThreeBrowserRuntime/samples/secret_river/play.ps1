$ErrorActionPreference = 'Stop'

$entry = Join-Path $PSScriptRoot 'site-entry.mjs'
$runtime = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'run.ps1'

if (-not (Test-Path -LiteralPath $runtime -PathType Leaf)) {
    throw "ThreeBrowserRuntime launcher not found at $runtime"
}
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
    throw "Game entry not found at $entry"
}

& $runtime $entry
exit $LASTEXITCODE
