param([string]$Root = (Split-Path -Parent $PSScriptRoot), [string]$Icon = "build\variants\main.png")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$sourcePath = if ([System.IO.Path]::IsPathRooted($Icon)) { $Icon } else { Join-Path $Root $Icon }
$source = [System.Drawing.Image]::FromFile($sourcePath)
$resourceRoot = Join-Path $Root "android\app\src\main\res"
function Write-LauncherImage([string]$Target, [int]$Size, [double]$Ratio, [bool]$Transparent, [bool]$Round) {
  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    if (-not $Transparent) {
      $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#F3F6F5"))
      try { if ($Round) { $graphics.FillEllipse($brush, 0, 0, $Size, $Size) } else { $graphics.FillRectangle($brush, 0, 0, $Size, $Size) } } finally { $brush.Dispose() }
    }
    $markSize = [int][Math]::Round($Size * $Ratio)
    $offset = [int][Math]::Round(($Size - $markSize) / 2)
    $graphics.DrawImage($source, $offset, $offset, $markSize, $markSize)
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $Target)) | Out-Null
    $bitmap.Save($Target, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
try {
  foreach ($density in @(@("mdpi",48,108),@("hdpi",72,162),@("xhdpi",96,216),@("xxhdpi",144,324),@("xxxhdpi",192,432))) {
    $directory = Join-Path $resourceRoot ("mipmap-" + $density[0])
    Write-LauncherImage (Join-Path $directory "ic_launcher.png") $density[1] 0.78 $false $false
    Write-LauncherImage (Join-Path $directory "ic_launcher_round.png") $density[1] 0.70 $false $true
    # Android adaptive foregrounds are 108 dp. Keep the mark inside the 66 dp safe zone.
    Write-LauncherImage (Join-Path $directory "ic_launcher_foreground.png") $density[2] (64.0 / 108.0) $true $false
  }
  Write-LauncherImage (Join-Path $resourceRoot "mipmap-anydpi-v26\ic_launcher_foreground.png") 432 (64.0 / 108.0) $true $false
  [System.IO.File]::WriteAllText((Join-Path $resourceRoot "values\ic_launcher_background.xml"), '<?xml version="1.0" encoding="utf-8"?><resources><color name="ic_launcher_background">#F3F6F5</color></resources>', (New-Object System.Text.UTF8Encoding($false)))
} finally { $source.Dispose() }
Write-Output "Generated density-specific legacy and adaptive Easy Commercial launcher icons."
