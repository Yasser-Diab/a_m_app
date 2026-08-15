$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$iconSource = Join-Path $root "New app brands\Icons_logo\EasyCommercial_Icon_Transparent.png"
$fullSource = Join-Path $root "New app brands\Icons_logo\EasyCommercial_Full_Transparent.png"

function Save-ResizedPng {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Dest,
    [Parameter(Mandatory = $true)][int]$Width,
    [Parameter(Mandatory = $true)][int]$Height
  )

  $src = [System.Drawing.Image]::FromFile($Source)
  try {
    $bmp = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $scale = [Math]::Min($Width / $src.Width, $Height / $src.Height)
        $drawWidth = [int]([Math]::Round($src.Width * $scale))
        $drawHeight = [int]([Math]::Round($src.Height * $scale))
        $x = [int](($Width - $drawWidth) / 2)
        $y = [int](($Height - $drawHeight) / 2)
        $g.DrawImage($src, $x, $y, $drawWidth, $drawHeight)
      } finally {
        $g.Dispose()
      }
      New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($Dest)) | Out-Null
      $bmp.Save($Dest, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $bmp.Dispose()
    }
  } finally {
    $src.Dispose()
  }
}

function Save-IcoFromPngs {
  param(
    [Parameter(Mandatory = $true)][string[]]$PngPaths,
    [Parameter(Mandatory = $true)][string]$Dest
  )

  $entries = @()
  $imageData = @()
  $offset = 6 + (16 * $PngPaths.Count)
  foreach ($png in $PngPaths) {
    $bytes = [System.IO.File]::ReadAllBytes($png)
    $img = [System.Drawing.Image]::FromFile($png)
    try {
      $widthByte = if ($img.Width -ge 256) { 0 } else { [byte]$img.Width }
      $heightByte = if ($img.Height -ge 256) { 0 } else { [byte]$img.Height }
      $entries += [pscustomobject]@{
        Width = $widthByte
        Height = $heightByte
        Size = $bytes.Length
        Offset = $offset
      }
      $imageData += ,$bytes
      $offset += $bytes.Length
    } finally {
      $img.Dispose()
    }
  }

  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  $bw.Write([UInt16]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]$PngPaths.Count)
  foreach ($entry in $entries) {
    $bw.Write([byte]$entry.Width)
    $bw.Write([byte]$entry.Height)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$entry.Size)
    $bw.Write([UInt32]$entry.Offset)
  }
  foreach ($bytes in $imageData) {
    $bw.Write($bytes)
  }
  $bw.Flush()
  [System.IO.File]::WriteAllBytes($Dest, $ms.ToArray())
  $bw.Dispose()
  $ms.Dispose()
}

Copy-Item -LiteralPath $iconSource -Destination (Join-Path $root "src\assets\easy-commercial-icon.png") -Force
Copy-Item -LiteralPath $fullSource -Destination (Join-Path $root "src\assets\easy-commercial-full.png") -Force
Copy-Item -LiteralPath $fullSource -Destination (Join-Path $root "src\assets\sticker logo s.png") -Force
Copy-Item -LiteralPath $fullSource -Destination (Join-Path $root "src\assets\export_logo.png") -Force

Save-ResizedPng $iconSource (Join-Path $root "build\icon.png") 1024 1024
Save-ResizedPng $iconSource (Join-Path $root "build\variants\main.png") 512 512

$tempDir = Join-Path $root "build\tmp-easy-commercial-ico"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$resolvedTemp = [System.IO.Path]::GetFullPath($tempDir)
$resolvedBuild = [System.IO.Path]::GetFullPath((Join-Path $root "build"))
if (-not $resolvedTemp.StartsWith($resolvedBuild, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write temporary icon files outside build: $resolvedTemp"
}

$pngs = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
  $pngPath = Join-Path $tempDir "icon-$size.png"
  Save-ResizedPng $iconSource $pngPath $size $size
  $pngs += $pngPath
}
Save-IcoFromPngs $pngs (Join-Path $root "build\icon.ico")
Save-IcoFromPngs $pngs (Join-Path $root "build\variants\main.ico")
Remove-Item -LiteralPath $tempDir -Recurse -Force

$androidRes = Join-Path $root "android\app\src\main\res"
$androidIconDirs = Get-ChildItem -Path $androidRes -Directory | Where-Object { $_.Name -like "mipmap-*" }
foreach ($dir in $androidIconDirs) {
  $iconNames =
    if ($dir.Name -eq "mipmap-anydpi-v26") {
      @("ic_launcher_foreground.png")
    } else {
      @("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png")
    }
  foreach ($name in $iconNames) {
    Save-ResizedPng $iconSource (Join-Path $dir.FullName $name) 512 512
  }
}
foreach ($splash in Get-ChildItem -Path $androidRes -Recurse -Filter "splash.png") {
  Save-ResizedPng $fullSource $splash.FullName 960 540
}

Write-Host "Generated Easy Commercial brand assets from $iconSource and $fullSource"
