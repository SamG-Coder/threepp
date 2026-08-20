# Self-contained win-x64 folder + zip. Native DLL must exist (run .\build.ps1 first
# or this script will build it).
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$outDir = Join-Path $repo 'publish\ThreeBrowser'
$zipPath = Join-Path $repo 'publish\ThreeBrowser-win-x64.zip'
$dll = Join-Path $repo 'build\bin\three_native.dll'

if (-not (Test-Path -LiteralPath $dll)) {
    Write-Host 'Native DLL missing — running .\build.ps1'
    & (Join-Path $repo 'build.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'build.ps1 failed.' }
} else {
    Write-Host 'Building three_native.dll'
    $toolRoot = 'C:\msys64\ucrt64\bin'
    $cmake = Join-Path $toolRoot 'cmake.exe'
    if (Test-Path -LiteralPath $cmake) {
        $env:Path = "$toolRoot;$env:Path"
        & $cmake --build (Join-Path $repo 'build') --target three_native --parallel
        if ($LASTEXITCODE -ne 0) { throw 'Native build failed.' }
    }
}

Write-Host 'Publishing ThreeBrowser (self-contained win-x64)'
if (Test-Path -LiteralPath $outDir) {
    Remove-Item -LiteralPath $outDir -Recurse -Force
}
New-Item -ItemType Directory -Path $outDir | Out-Null

dotnet publish (Join-Path $repo 'host\ThreeBrowser\ThreeBrowser.csproj') `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -o $outDir
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed.' }

$publishedDll = Join-Path $outDir 'three_native.dll'
if (-not (Test-Path -LiteralPath $publishedDll)) {
    Copy-Item -Force $dll $publishedDll
}

$exe = Join-Path $outDir 'ThreeBrowser.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "Missing $exe" }

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "Published: $exe"
Write-Host "Zip:       $zipPath"
Write-Host 'Requires the WebView2 Evergreen runtime (included on Windows 11).'
