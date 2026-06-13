$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json
$version = $packageJson.version
$releaseRoot = "D:\releases"
$releaseDir = Join-Path $releaseRoot "AccountingManagement_V$version"
$zipPath = Join-Path $releaseRoot "AccountingManagement_V$version`_release.zip"

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
Get-ChildItem -LiteralPath $releaseDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Remove-Item -Force -ErrorAction SilentlyContinue $zipPath

$installer = Get-ChildItem -Path (Join-Path $root "dist-installer") -Filter "AccountingManagement-Setup-*.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$apk = Get-ChildItem -Path (Join-Path $root "android\app\build\outputs\apk") -Filter "*.apk" -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($installer) {
  Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $releaseDir $installer.Name) -Force
}

if ($apk) {
  Copy-Item -LiteralPath $apk.FullName -Destination (Join-Path $releaseDir "AccountingManagement-Android-v$version.apk") -Force
}

Copy-Item -LiteralPath (Join-Path $root "INSTALL.txt") -Destination (Join-Path $releaseDir "INSTALL.txt") -Force

if (Test-Path (Join-Path $root "dist")) {
  $webDir = Join-Path $releaseDir "web"
  New-Item -ItemType Directory -Force -Path $webDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $root "dist") -Destination $webDir -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $root "server") -Destination $webDir -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $root "package.json") -Destination $webDir -Force
  Copy-Item -LiteralPath (Join-Path $root "run_server.py") -Destination $webDir -Force
}

Compress-Archive -Path (Join-Path $releaseDir "*") -DestinationPath $zipPath -Force
Write-Host $zipPath
