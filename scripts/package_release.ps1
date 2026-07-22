$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json
$version = [string]$packageJson.version
$releaseRoot = "D:\releases"
$releaseDir = Join-Path $releaseRoot "AccountingManagement_V$version"
$zipPath = Join-Path $releaseRoot "AccountingManagement_V$version`_release.zip"
$winDir = Join-Path $releaseRoot "win"
$apkDir = Join-Path $releaseRoot "apk"
$releaseWinDir = Join-Path $releaseDir "windows"
$releaseApkDir = Join-Path $releaseDir "android"

function Invoke-CheckedNative {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Copy-NamedArtifact {
  param(
    [Parameter(Mandatory = $true)][System.IO.FileInfo]$File,
    [Parameter(Mandatory = $true)][string]$Directory,
    [string]$Name
  )
  $destinationName = if ($Name) { $Name } else { $File.Name }
  Copy-Item -LiteralPath $File.FullName -Destination (Join-Path $Directory $destinationName) -Force
}

Push-Location $root
try {
  Invoke-CheckedNative npm run dist:win
  Invoke-CheckedNative npm run android:debug
}
finally {
  Pop-Location
}

$env:VITE_APP_VARIANT = "main"
try {
  Push-Location $root
  try {
    Invoke-CheckedNative npm run build:web:raw
    Invoke-CheckedNative node scripts/verify_built_assets.cjs dist
  }
  finally {
    Pop-Location
  }
}
finally {
  Remove-Item Env:\VITE_APP_VARIANT -ErrorAction SilentlyContinue
}

$installerRoot = Join-Path $root "dist-installer"
$androidRoot = Join-Path $root "dist-android"

$setupInstallers = Get-ChildItem -Path $installerRoot -Filter "*-Setup-$version.exe" -Recurse -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -notmatch "\\AMManager\\" -and
    $_.FullName -notmatch "\\AMController\\" -and
    $_.Name -notlike "AMManager-*" -and
    $_.Name -notlike "AMController-*"
  } |
  Sort-Object Name

$unpackedApps = Get-ChildItem -Path $installerRoot -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -match "\\win-unpacked\\[^\\]+\.exe$" -and
    $_.FullName -notmatch "\\resources\\" -and
    $_.FullName -notmatch "\\AMManager\\" -and
    $_.FullName -notmatch "\\AMController\\"
  } |
  Sort-Object Name

$apks = Get-ChildItem -Path $androidRoot -Filter "*-v$version-debug.apk" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike "AMManager-*" -and $_.Name -notlike "AMController-*" } |
  Sort-Object Name

if (-not $setupInstallers.Count) {
  throw "No Windows setup EXE files were found for version $version under $installerRoot. Run npm run dist:win and check the build output."
}
if (-not $apks.Count) {
  throw "No Android APK files were found for version $version under $androidRoot. Run npm run android:debug and check the build output."
}

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
New-Item -ItemType Directory -Force -Path $winDir | Out-Null
New-Item -ItemType Directory -Force -Path $apkDir | Out-Null
Get-ChildItem -LiteralPath $releaseDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $winDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $apkDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Remove-Item -Force -ErrorAction SilentlyContinue $zipPath
New-Item -ItemType Directory -Force -Path $releaseWinDir | Out-Null
New-Item -ItemType Directory -Force -Path $releaseApkDir | Out-Null

foreach ($installer in $setupInstallers) {
  Copy-NamedArtifact -File $installer -Directory $winDir
  Copy-NamedArtifact -File $installer -Directory $releaseWinDir
}

foreach ($appExe in $unpackedApps) {
  Copy-NamedArtifact -File $appExe -Directory $winDir
  Copy-NamedArtifact -File $appExe -Directory $releaseWinDir
}

foreach ($apk in $apks) {
  Copy-NamedArtifact -File $apk -Directory $apkDir
  Copy-NamedArtifact -File $apk -Directory $releaseApkDir
}

$mainInstaller = $setupInstallers | Where-Object { $_.Name -like "AccountingManagement-Setup-*" } | Select-Object -First 1
$mainApk = $apks | Where-Object { $_.Name -like "AccountingManagement-Android-*" } | Select-Object -First 1
if ($mainInstaller) {
  Copy-NamedArtifact -File $mainInstaller -Directory $releaseDir
}
if ($mainApk) {
  Copy-NamedArtifact -File $mainApk -Directory $releaseDir -Name "AccountingManagement-Android-v$version.apk"
}

Copy-Item -LiteralPath (Join-Path $root "INSTALL.txt") -Destination (Join-Path $releaseDir "INSTALL.txt") -Force
$versionInstall = Join-Path $root "INSTALL_$version.md"
if (Test-Path $versionInstall) {
  Copy-Item -LiteralPath $versionInstall -Destination (Join-Path $releaseDir "INSTALL_$version.md") -Force
}
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination (Join-Path $releaseDir "README.md") -Force

if (Test-Path (Join-Path $root "dist")) {
  $webDir = Join-Path $releaseDir "web"
  New-Item -ItemType Directory -Force -Path $webDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $root "dist") -Destination $webDir -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $root "package.json") -Destination $webDir -Force
  Copy-Item -LiteralPath (Join-Path $root "package-lock.json") -Destination $webDir -Force
}

Compress-Archive -Path (Join-Path $releaseDir "*") -DestinationPath $zipPath -Force

Write-Host "Copied Windows files:"
$setupInstallers | ForEach-Object { Write-Host " - $($_.Name)" }
$unpackedApps | ForEach-Object { Write-Host " - $($_.Name)" }
Write-Host "Copied Android APKs:"
$apks | ForEach-Object { Write-Host " - $($_.Name)" }
Write-Host "Windows installers/executables: $winDir"
Write-Host "Android APKs: $apkDir"
Write-Host "Release archive: $zipPath"
