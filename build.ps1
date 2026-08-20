$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$toolRoot = 'C:\msys64\ucrt64\bin'
$cmake = Join-Path $toolRoot 'cmake.exe'
$ninja = Join-Path $toolRoot 'ninja.exe'
$compiler = Join-Path $toolRoot 'g++.exe'
if (-not (Test-Path -LiteralPath $cmake)) { throw 'MSYS2 UCRT64 CMake is missing.' }
if (-not (Test-Path -LiteralPath $compiler)) { throw 'MSYS2 UCRT64 g++ is missing.' }
$env:Path = "$toolRoot;$env:Path"

Write-Host 'Configuring threepp + three_native.dll (examples/tests/editor off)'
& $cmake -S $repo -B (Join-Path $repo 'build') -G Ninja `
    "-DCMAKE_MAKE_PROGRAM=$ninja" `
    "-DCMAKE_CXX_COMPILER=$compiler" `
    -DCMAKE_BUILD_TYPE=Release `
    -DTHREEPP_BUILD_EXAMPLES=OFF `
    -DTHREEPP_BUILD_TESTS=OFF `
    -DTHREEPP_BUILD_EDITOR=OFF `
    -DTHREEPP_WITH_AUDIO=OFF `
    -DTHREEPP_WITH_PYTHON=OFF `
    -DTHREEPP_WITH_JS_HOST=ON
if ($LASTEXITCODE -ne 0) { throw 'CMake configuration failed.' }

Write-Host 'Building three_native'
& $cmake --build (Join-Path $repo 'build') --target three_native --parallel
if ($LASTEXITCODE -ne 0) { throw 'Native build failed.' }

$dll = Join-Path $repo 'build\bin\three_native.dll'
if (-not (Test-Path -LiteralPath $dll)) { throw "Missing $dll" }

Write-Host 'Building C# WebView2 host'
dotnet build (Join-Path $repo 'host\ThreeBrowser\ThreeBrowser.csproj') -c Release
if ($LASTEXITCODE -ne 0) { throw 'dotnet build failed.' }

$hostOut = Join-Path $repo 'host\ThreeBrowser\bin\Release\net10.0-windows'
Copy-Item -Force $dll (Join-Path $hostOut 'three_native.dll')
Write-Host "Built: $hostOut\ThreeBrowser.exe"
Write-Host 'Run: .\run.ps1'
