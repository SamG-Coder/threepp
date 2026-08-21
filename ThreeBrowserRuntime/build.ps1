$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$build = Join-Path $PSScriptRoot 'build'
$ucrt = 'C:\msys64\ucrt64\bin'
$ninja = Join-Path $ucrt 'ninja.exe'
$cc = Join-Path $ucrt 'gcc.exe'
$cxx = Join-Path $ucrt 'g++.exe'

foreach ($tool in @($ninja, $cc, $cxx)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
        throw "Required MSYS2 UCRT64 tool not found: $tool"
    }
}

# GCC launches cc1/ld helper processes whose UCRT runtime DLLs live beside the
# compiler. Keep this change scoped to the build process and its children.
$env:Path = "$ucrt;$env:Path"

cmake -S $repo -B $build -G Ninja `
    "-DCMAKE_MAKE_PROGRAM=$ninja" `
    "-DCMAKE_C_COMPILER=$cc" `
    "-DCMAKE_CXX_COMPILER=$cxx" `
    -DCMAKE_BUILD_TYPE=Release `
    -DTHREEPP_BUILD_RUNTIME=ON `
    -DTHREEPP_BUILD_EXAMPLES=OFF `
    -DTHREEPP_BUILD_TESTS=OFF `
    -DTHREEPP_BUILD_EDITOR=OFF `
    -DTHREEPP_WITH_AUDIO=OFF
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

cmake --build $build --target three_browser_runtime_stage
exit $LASTEXITCODE
