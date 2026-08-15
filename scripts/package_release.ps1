$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json
$config = Get-Content -Raw -LiteralPath (Join-Path $root "config\app-variants.json") | ConvertFrom-Json
$version = if ($env:AM_BUILD_VERSION) {
  [string]$env:AM_BUILD_VERSION
} elseif ($config.version) {
  [string]$config.version
} else {
  [string]$packageJson.version
}
$versionParts = @($version -split "\D+" | Where-Object { $_ -ne "" })
$majorVersion = if ($versionParts.Count -gt 0) { [int]$versionParts[0] } else { 0 }
$minorVersion = if ($versionParts.Count -gt 1) { [int]$versionParts[1] } else { 0 }
$patchVersion = if ($versionParts.Count -gt 2) { [int]$versionParts[2] } else { 0 }
$androidVersionCode = ($majorVersion * 1000000) + ($minorVersion * 1000) + $patchVersion
$releaseRoot = if ($env:EASY_COMMERCIAL_RELEASE_ROOT) {
  $env:EASY_COMMERCIAL_RELEASE_ROOT
} else {
  Join-Path $root "releases"
}
$releaseDir = Join-Path $releaseRoot "EasyCommercial_V$version"
$zipPath = Join-Path $releaseRoot "EasyCommercial_V$version`_release.zip"
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

function New-ReleaseAssetInfo {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AssetName
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  $file = Get-Item -LiteralPath $Path
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($file.FullName)
  try {
    $hashBytes = $sha256.ComputeHash($stream)
  }
  finally {
    $stream.Dispose()
    $sha256.Dispose()
  }
  $hash = -join ($hashBytes | ForEach-Object { $_.ToString("x2") })
  return [ordered]@{
    assetName = $AssetName
    downloadUrl = $AssetName
    sha256 = $hash
    size = [int64]$file.Length
    required = $false
  }
}

Push-Location $root
try {
  $env:AM_BUILD_VERSION = $version
  $env:VITE_APP_VERSION = $version
  Invoke-CheckedNative npm run dist:win
  Invoke-CheckedNative npm run android:debug
}
finally {
  Remove-Item Env:\AM_BUILD_VERSION -ErrorAction SilentlyContinue
  Remove-Item Env:\VITE_APP_VERSION -ErrorAction SilentlyContinue
  Pop-Location
}

$env:VITE_APP_VARIANT = "main"
$env:VITE_APP_VERSION = $version
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
  Remove-Item Env:\VITE_APP_VERSION -ErrorAction SilentlyContinue
}

$installerRoot = Join-Path $root "dist-installer"
$androidRoot = Join-Path $root "dist-android"
$currentInstallerDir = Join-Path $installerRoot "EasyCommercial"

$setupInstallers = Get-ChildItem -Path $currentInstallerDir -Filter "EasyCommercial-Setup-$version.exe" -Recurse -ErrorAction SilentlyContinue |
  Sort-Object Name

$unpackedApps = Get-ChildItem -Path $currentInstallerDir -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -match "\\win-unpacked\\Easy Commercial\.exe$" -and
    $_.FullName -notmatch "\\resources\\"
  } |
  Sort-Object Name

$windowsUpdateAssets = @()
$latestYml = Get-ChildItem -Path $currentInstallerDir -Filter "latest.yml" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($latestYml) { $windowsUpdateAssets += $latestYml }
$setupBlockmap = Get-ChildItem -Path $currentInstallerDir -Filter "EasyCommercial-Setup-$version.exe.blockmap" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($setupBlockmap) { $windowsUpdateAssets += $setupBlockmap }

$apks = Get-ChildItem -Path $androidRoot -Filter "*-v$version-debug.apk" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike "AMManager-*" -and $_.Name -notlike "AMController-*" } |
  Sort-Object Name

if (-not $setupInstallers.Count) {
  throw "No Windows setup EXE files were found for version $version under $installerRoot. Run npm run dist:win and check the build output."
}
if (-not $latestYml -or -not $setupBlockmap) {
  throw "Windows update metadata is incomplete. Expected latest.yml and EasyCommercial-Setup-$version.exe.blockmap under $currentInstallerDir."
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

foreach ($updateAsset in $windowsUpdateAssets) {
  Copy-NamedArtifact -File $updateAsset -Directory $winDir
  Copy-NamedArtifact -File $updateAsset -Directory $releaseWinDir
  Copy-NamedArtifact -File $updateAsset -Directory $releaseDir
}

foreach ($apk in $apks) {
  Copy-NamedArtifact -File $apk -Directory $apkDir
  Copy-NamedArtifact -File $apk -Directory $releaseApkDir
}

$mainInstaller = $setupInstallers | Where-Object { $_.Name -like "EasyCommercial-Setup-*" } | Select-Object -First 1
$mainApk = $apks | Where-Object { $_.Name -like "EasyCommercial-Android-*" } | Select-Object -First 1
if ($mainInstaller) {
  Copy-NamedArtifact -File $mainInstaller -Directory $releaseDir
}
if ($mainApk) {
  Copy-NamedArtifact -File $mainApk -Directory $releaseDir -Name "EasyCommercial-Android-v$version.apk"
  Copy-NamedArtifact -File $mainApk -Directory $apkDir -Name "EasyCommercial-Android-v$version.apk"
  Copy-NamedArtifact -File $mainApk -Directory $releaseApkDir -Name "EasyCommercial-Android-v$version.apk"
}

$manifestPath = Join-Path $releaseDir "easy-commercial-update.json"
$windowsAssetPath = if ($mainInstaller) { Join-Path $releaseDir $mainInstaller.Name } else { "" }
$androidAssetName = "EasyCommercial-Android-v$version.apk"
$androidAssetPath = Join-Path $releaseDir $androidAssetName
$windowsAsset = if ($mainInstaller) { New-ReleaseAssetInfo -Path $windowsAssetPath -AssetName $mainInstaller.Name } else { $null }
$androidAsset = if (Test-Path -LiteralPath $androidAssetPath) { New-ReleaseAssetInfo -Path $androidAssetPath -AssetName $androidAssetName } else { $null }
$arabicReleaseNote = -join @(
  [char]0x062a, [char]0x062d, [char]0x062f, [char]0x064a, [char]0x062b,
  [char]0x0020,
  [char]0x0627, [char]0x0633, [char]0x062a, [char]0x0642, [char]0x0631, [char]0x0627, [char]0x0631
)
$manifest = [ordered]@{
  version = $version
  channel = "stable"
  publishedAt = (Get-Date).ToUniversalTime().ToString("o")
  minimumSupportedVersion = "2.0.0"
  databaseSchemaVersion = 12
  serverApiVersion = 2
  releaseNotes = [ordered]@{
    ar = "$arabicReleaseNote Easy Commercial $version."
    en = "Easy Commercial $version stability update."
  }
  windows = if ($windowsAsset) {
    [ordered]@{
      version = $version
      downloadUrl = $windowsAsset.downloadUrl
      sha256 = $windowsAsset.sha256
      size = $windowsAsset.size
      required = $false
    }
  } else { $null }
  android = if ($androidAsset) {
    [ordered]@{
      versionName = $version
      versionCode = $androidVersionCode
      downloadUrl = $androidAsset.downloadUrl
      sha256 = $androidAsset.sha256
      size = $androidAsset.size
      required = $false
    }
  } else { $null }
}
$manifestJson = $manifest | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $releaseRoot "easy-commercial-update.json") -Force

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
$windowsUpdateAssets | ForEach-Object { Write-Host " - $($_.Name)" }
Write-Host "Copied Android APKs:"
$apks | ForEach-Object { Write-Host " - $($_.Name)" }
Write-Host "Windows installers/executables: $winDir"
Write-Host "Android APKs: $apkDir"
Write-Host "Release archive: $zipPath"
