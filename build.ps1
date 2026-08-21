$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$toolRoot = 'C:\msys64\ucrt64\bin'
$cmake = Join-Path $toolRoot 'cmake.exe'
$ninja = Join-Path $toolRoot 'ninja.exe'
$compiler = Join-Path $toolRoot 'g++.exe'
if (-not (Test-Path -LiteralPath $cmake)) { throw 'MSYS2 UCRT64 CMake is missing.' }
if (-not (Test-Path -LiteralPath $compiler)) { throw 'MSYS2 UCRT64 g++ is missing.' }
$env:Path = "$toolRoot;$env:Path"
if (-not $env:VULKAN_SDK) {
    $sdkRoot = 'C:\VulkanSDK'
    if (Test-Path -LiteralPath $sdkRoot) {
        $latest = Get-ChildItem -LiteralPath $sdkRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
        if ($latest) { $env:VULKAN_SDK = $latest.FullName }
    }
}
if ($env:VULKAN_SDK) { $env:Path = "$($env:VULKAN_SDK)\Bin;$env:Path" }

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
    -DTHREEPP_WITH_JS_HOST=ON `
    -DTHREEPP_WITH_VULKAN=ON
if ($LASTEXITCODE -ne 0) { throw 'CMake configuration failed.' }

Write-Host 'Building three_native + cubes command-ring test + three_webgpu'
& $cmake --build (Join-Path $repo 'build') --target three_native three_native_cubes three_webgpu three_webgpu_smoke --parallel
if ($LASTEXITCODE -ne 0) { throw 'Native build failed.' }

$cubes = Join-Path $repo 'build\bin\three_native_cubes.exe'
if (Test-Path -LiteralPath $cubes) {
    Write-Host 'Running three_native_cubes'
    & $cubes
    if ($LASTEXITCODE -ne 0) { throw 'three_native_cubes failed.' }
}

$wgSmoke = Join-Path $repo 'build\bin\three_webgpu_smoke.exe'
if (Test-Path -LiteralPath $wgSmoke) {
    Write-Host 'Running three_webgpu_smoke'
    & $wgSmoke
    if ($LASTEXITCODE -ne 0) { throw 'three_webgpu_smoke failed.' }
}

$dll = Join-Path $repo 'build\bin\three_native.dll'
if (-not (Test-Path -LiteralPath $dll)) { throw "Missing $dll" }
$wgDll = Join-Path $repo 'build\bin\three_webgpu.dll'
if (-not (Test-Path -LiteralPath $wgDll)) { throw "Missing $wgDll" }
$wgpuDll = Join-Path $repo 'build\bin\wgpu_native.dll'
if (-not (Test-Path -LiteralPath $wgpuDll)) { throw "Missing $wgpuDll" }

Write-Host 'Building C# WebView2 host'
dotnet build (Join-Path $repo 'host\ThreeBrowser\ThreeBrowser.csproj') -c Release
if ($LASTEXITCODE -ne 0) { throw 'dotnet build failed.' }

$hostOut = Join-Path $repo 'host\ThreeBrowser\bin\Release\net10.0-windows'
Copy-Item -Force $dll (Join-Path $hostOut 'three_native.dll')
Copy-Item -Force $wgDll (Join-Path $hostOut 'three_webgpu.dll')
Copy-Item -Force $wgpuDll (Join-Path $hostOut 'wgpu_native.dll')
Write-Host "Built: $hostOut\ThreeBrowser.exe"
Write-Host 'Run: .\run.ps1'
