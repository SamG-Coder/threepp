$ErrorActionPreference = 'Stop'
$bin = Join-Path $PSScriptRoot 'build\bin'
$launcher = Join-Path $bin 'runtime\launch.mjs'
$entry = if ($args.Count) { $args[0] } else { Join-Path $bin 'demo\cubes.mjs' }

if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw 'Runtime is not built. Run .\build.ps1 first.'
}

& node $launcher $entry
exit $LASTEXITCODE
