param(
    [string]$Version = '0.03'
)

# Builds one self-contained Windows x64 release containing both applications:
#   ThreeBrowser\ThreeBrowser.exe
#   ThreeBrowserRuntime\ThreeBrowserRuntime.exe
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$publishRoot = Join-Path $repo 'publish'
$packageName = "ThreeBrowser-$Version-win-x64"
$packageRoot = Join-Path $publishRoot $packageName
$browserOut = Join-Path $packageRoot 'ThreeBrowser'
$runtimeOut = Join-Path $packageRoot 'ThreeBrowserRuntime'
$zipPath = Join-Path $publishRoot "$packageName.zip"
$runtimeBin = Join-Path $repo 'ThreeBrowserRuntime\build\bin'
$nodeSource = (Get-Command node.exe -ErrorAction Stop).Source

function Remove-PublishTarget([string]$Target) {
    if (-not (Test-Path -LiteralPath $Target)) { return }
    $resolvedRoot = [IO.Path]::GetFullPath($publishRoot).TrimEnd('\')
    $resolvedTarget = [IO.Path]::GetFullPath($Target).TrimEnd('\')
    if ([string]::IsNullOrWhiteSpace($resolvedTarget) -or
        -not $resolvedTarget.StartsWith($resolvedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside the publish directory: $resolvedTarget"
    }
    $item = Get-Item -LiteralPath $resolvedTarget -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to remove a linked publish target: $resolvedTarget"
    }
    $linkedChild = Get-ChildItem -LiteralPath $resolvedTarget -Force -Recurse -ErrorAction Stop |
        Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 } |
        Select-Object -First 1
    if ($null -ne $linkedChild) {
        throw "Refusing to remove a publish tree containing a link: $($linkedChild.FullName)"
    }
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force -ErrorAction Stop
}

New-Item -ItemType Directory -Force -Path $publishRoot | Out-Null
Remove-PublishTarget $packageRoot
if (Test-Path -LiteralPath $zipPath -PathType Leaf) {
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction Stop
}
New-Item -ItemType Directory -Path $browserOut, $runtimeOut | Out-Null

Write-Host 'Publishing ThreeBrowser (self-contained win-x64)'
dotnet publish (Join-Path $repo 'host\ThreeBrowser\ThreeBrowser.csproj') `
    -c Release -r win-x64 --self-contained true -o $browserOut
if ($LASTEXITCODE -ne 0) { throw 'ThreeBrowser publish failed.' }

Write-Host 'Publishing ThreeBrowserRuntime (self-contained win-x64)'
dotnet publish (Join-Path $repo 'ThreeBrowserRuntime\ThreeBrowserRuntime.csproj') `
    -c Release -r win-x64 --self-contained true -o $runtimeOut
if ($LASTEXITCODE -ne 0) { throw 'ThreeBrowserRuntime publish failed.' }

if (-not (Test-Path -LiteralPath (Join-Path $runtimeBin 'runtime\launch.mjs') -PathType Leaf)) {
    throw 'The staged native runtime is missing runtime\launch.mjs.'
}

# The native build is staged outside MSBuild's normal publish item graph.
$packagedRuntimeBin = Join-Path $runtimeOut 'build\bin'
New-Item -ItemType Directory -Force -Path $packagedRuntimeBin | Out-Null
Copy-Item -LiteralPath (Join-Path $runtimeBin 'runtime') -Destination $packagedRuntimeBin -Recurse -Force
Copy-Item -LiteralPath (Join-Path $runtimeBin 'demo') -Destination $packagedRuntimeBin -Recurse -Force
$runtimePayloadFiles = @(
    'glslangValidator.exe',
    'libgcc_s_seh-1.dll',
    'libstdc++-6.dll',
    'libwinpthread-1.dll',
    'NvLowLatencyVk.dll',
    'nvngx_dlss.dll',
    'nvngx_dlssd.dll',
    'nvngx_dlssg.dll',
    'sl.common.dll',
    'sl.dlss_d.dll',
    'sl.dlss_g.dll',
    'sl.dlss.dll',
    'sl.interposer.dll',
    'sl.pcl.dll',
    'sl.reflex.dll',
    'three_browser_runtime.node',
    'three_native.dll',
    'three_webgpu.dll',
    'wgpu_native.dll'
)
foreach ($fileName in $runtimePayloadFiles) {
    $source = Join-Path $runtimeBin $fileName
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Native runtime payload missing: $source"
    }
    Copy-Item -LiteralPath $source -Destination $packagedRuntimeBin -Force
}
$vcRuntimeFiles = @('msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll')
foreach ($fileName in $vcRuntimeFiles) {
    $source = Join-Path ([Environment]::GetFolderPath('System')) $fileName
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Microsoft VC++ runtime dependency missing: $source"
    }
    Copy-Item -LiteralPath $source -Destination $packagedRuntimeBin -Force
}
Copy-Item -LiteralPath (Join-Path $repo 'ThreeBrowserRuntime\samples') -Destination $runtimeOut -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repo 'ThreeBrowserRuntime\node_modules') -Destination $runtimeOut -Recurse -Force
Copy-Item -LiteralPath $nodeSource -Destination (Join-Path $runtimeOut 'node.exe') -Force

Copy-Item -LiteralPath (Join-Path $repo 'LICENSE') -Destination (Join-Path $packageRoot 'LICENSE.txt') -Force
Copy-Item -LiteralPath (Join-Path $repo 'THIRD_PARTY.md') -Destination (Join-Path $packageRoot 'THIRD_PARTY.md') -Force

$readme = @"
ThreeBrowser $Version - Windows x64

ThreeBrowser\ThreeBrowser.exe
  Browser host with WebView2 and native Three.js/WebGPU rendering.

ThreeBrowserRuntime\ThreeBrowserRuntime.exe
  WebView-free native project importer and launcher. Node.js is bundled for
  the JavaScript execution host; no separate Node installation is required.

Both applications require 64-bit Windows. The launcher UI uses the Microsoft
WebView2 Evergreen Runtime, included with Windows 11 and available separately
for supported Windows versions.
"@
Set-Content -LiteralPath (Join-Path $packageRoot 'README.txt') -Value $readme -Encoding utf8

$requiredFiles = @(
    (Join-Path $browserOut 'ThreeBrowser.exe'),
    (Join-Path $browserOut 'three_native.dll'),
    (Join-Path $browserOut 'three_webgpu.dll'),
    (Join-Path $browserOut 'wgpu_native.dll'),
    (Join-Path $runtimeOut 'ThreeBrowserRuntime.exe'),
    (Join-Path $runtimeOut 'node.exe'),
    (Join-Path $packagedRuntimeBin 'three_browser_runtime.node'),
    (Join-Path $packagedRuntimeBin 'three_native.dll'),
    (Join-Path $packagedRuntimeBin 'three_webgpu.dll'),
    (Join-Path $packagedRuntimeBin 'wgpu_native.dll'),
    (Join-Path $packagedRuntimeBin 'glslangValidator.exe'),
    (Join-Path $packagedRuntimeBin 'msvcp140.dll'),
    (Join-Path $packagedRuntimeBin 'vcruntime140.dll'),
    (Join-Path $packagedRuntimeBin 'vcruntime140_1.dll'),
    (Join-Path $packagedRuntimeBin 'runtime\launch.mjs')
)
foreach ($required in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Release dependency missing: $required"
    }
}

Compress-Archive -Path (Join-Path $packageRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
Write-Host "Package: $zipPath"
Write-Host "SHA-256: $hash"
