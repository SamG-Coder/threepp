# Pack host/ThreeBrowser/app.ico from a square source image (JPEG/PNG).
# Usage: .\scripts\bake-app-icon.ps1 -Source path\to\icon.jpg
param(
    [Parameter(Mandatory = $true)]
    [string] $Source
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$repo = Split-Path $PSScriptRoot -Parent
$outIco = Join-Path $repo 'host\ThreeBrowser\app.ico'
$outPng = Join-Path $repo 'host\ThreeBrowser\app.png'
if (-not (Test-Path -LiteralPath $Source)) { throw "Missing icon source: $Source" }

$srcImg = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Source))
try {
    $bmp = New-Object System.Drawing.Bitmap $srcImg.Width, $srcImg.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.DrawImage($srcImg, 0, 0, $srcImg.Width, $srcImg.Height)
    $g.Dispose()
} finally {
    $srcImg.Dispose()
}

# Cover the generator watermark in the bottom-right without touching the cube.
$sampleX = [Math]::Max(0, [int]($bmp.Width * 0.50))
$sampleY = [Math]::Max(0, [int]($bmp.Height * 0.08))
$fill = $bmp.GetPixel($sampleX, $sampleY)
$coverW = [int]($bmp.Width * 0.22)
$coverH = [int]($bmp.Height * 0.11)
$coverX = $bmp.Width - $coverW
$coverY = $bmp.Height - $coverH
$pg = [System.Drawing.Graphics]::FromImage($bmp)
$pg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
$brush = New-Object System.Drawing.SolidBrush $fill
$pg.FillRectangle($brush, $coverX, $coverY, $coverW, $coverH)
$brush.Dispose()
$pg.Dispose()

$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$blobs = New-Object System.Collections.Generic.List[byte[]]
foreach ($s in $sizes) {
    $frame = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $fg = [System.Drawing.Graphics]::FromImage($frame)
    $fg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $fg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $fg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $fg.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $fg.Clear([System.Drawing.Color]::Transparent)
    $fg.DrawImage($bmp, 0, 0, $s, $s)
    $fg.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $frame.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $blobs.Add($ms.ToArray())
    $frame.Dispose()
    $ms.Dispose()
}

$png256 = New-Object System.Drawing.Bitmap 256, 256, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g256 = [System.Drawing.Graphics]::FromImage($png256)
$g256.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g256.DrawImage($bmp, 0, 0, 256, 256)
$g256.Dispose()
$png256.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
$png256.Dispose()
$bmp.Dispose()

$count = $sizes.Length
$header = 6 + (16 * $count)
$offset = $header
$ico = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ico
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$count)
for ($i = 0; $i -lt $count; $i++) {
    $dim = $sizes[$i]
    $bw.Write([byte]$(if ($dim -ge 256) { 0 } else { $dim }))
    $bw.Write([byte]$(if ($dim -ge 256) { 0 } else { $dim }))
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$blobs[$i].Length)
    $bw.Write([uint32]$offset)
    $offset += $blobs[$i].Length
}
foreach ($blob in $blobs) { $bw.Write($blob) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($outIco, $ico.ToArray())
$bw.Dispose()
$ico.Dispose()
Write-Host "Wrote $outIco"
Write-Host "Wrote $outPng"
