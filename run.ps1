$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'host\ThreeBrowser\bin\Release\net10.0-windows\ThreeBrowser.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Build first: .\build.ps1' }
Start-Process $exe
