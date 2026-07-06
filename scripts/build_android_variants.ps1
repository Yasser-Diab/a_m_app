$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$configPath = Join-Path $root "config\app-variants.json"
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json
$version = if ($packageJson.version) { [string]$packageJson.version } else { [string]$config.version }
$digits = ($version -replace "\D", "")
$versionCode = [int]($digits.PadRight(3, "0").Substring(0, 3))
$variantNames = @("main")

$capacitorPath = Join-Path $root "capacitor.config.json"
$gradlePath = Join-Path $root "android\app\build.gradle"
$stringsPath = Join-Path $root "android\app\src\main\res\values\strings.xml"
$androidOutput = if ($config.androidOutput) { $config.androidOutput } else { "dist-android" }
$outputDir = Join-Path $root $androidOutput
$temporaryAssetDirs = @()

$originalCapacitor = Get-Content -Raw -LiteralPath $capacitorPath
$originalGradle = Get-Content -Raw -LiteralPath $gradlePath
$originalStrings = Get-Content -Raw -LiteralPath $stringsPath
$originalCapacitor = $originalCapacitor -replace "^\uFEFF", ""
$originalGradle = $originalGradle -replace "^\uFEFF", ""
$originalStrings = $originalStrings -replace "^\uFEFF", ""

function Set-TextNoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Value
  )
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

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

function Clear-CapacitorGeneratedBuild {
  $resolvedRoot = [System.IO.Path]::GetFullPath($root)
  $relativeTargets = @(
    "node_modules\@capacitor\android\capacitor\build",
    "node_modules\@capacitor\filesystem\android\build",
    "node_modules\@capacitor\local-notifications\android\build",
    "node_modules\@capacitor\share\android\build",
    "android\app\build",
    "android\capacitor-cordova-android-plugins\build"
  )
  foreach ($relativeTarget in $relativeTargets) {
    $target = [System.IO.Path]::GetFullPath((Join-Path $root $relativeTarget))
    if (-not $target.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to clean unexpected Capacitor build path: $target"
    }
    if (-not (Test-Path -LiteralPath $target)) { continue }
    & attrib -R "$target\*" /S /D 2>$null
    for ($attempt = 1; $attempt -le 3; $attempt += 1) {
      try {
        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
        break
      }
      catch {
        if ($attempt -eq 3) { throw }
        Start-Sleep -Milliseconds (500 * $attempt)
      }
    }
  }
}

function Clear-CapacitorWebAssets {
  $assetRoot = [System.IO.Path]::GetFullPath((Join-Path $root "android\app\src\main\assets"))
  $publicAssets = [System.IO.Path]::GetFullPath((Join-Path $assetRoot "public"))
  if (-not $publicAssets.StartsWith($assetRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean unexpected Android asset path: $publicAssets"
  }
  if (Test-Path -LiteralPath $publicAssets) {
    Remove-Item -LiteralPath $publicAssets -Recurse -Force
  }
}

function Set-AndroidVariantIcon {
  param([object]$Variant)
  $iconSource = Join-Path $root ([string]$Variant.androidIcon)
  if (-not (Test-Path -LiteralPath $iconSource)) {
    throw "Missing Android icon for $($Variant.name): $iconSource"
  }
  Get-ChildItem -LiteralPath (Join-Path $root "android\app\src\main\res") -Recurse -File |
    Where-Object { $_.Name -in @("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png") } |
    ForEach-Object { Copy-Item -LiteralPath $iconSource -Destination $_.FullName -Force }
}

function Convert-CapacitorAssetsToRegularFiles {
  $assetRoot = Join-Path $root "android\app\src\main\assets\public"
  if (-not (Test-Path -LiteralPath $assetRoot)) { return }
  Get-ChildItem -LiteralPath $assetRoot -Recurse -File | ForEach-Object {
    $filePath = $_.FullName
    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    Remove-Item -LiteralPath $filePath -Force
    [System.IO.File]::WriteAllBytes($filePath, $bytes)
  }
}

function Copy-CapacitorAssetsToLocalBuildDir {
  param([string]$VariantName)
  $sourceRoot = Join-Path $root "android\app\src\main\assets"
  $targetRoot = Join-Path ([System.IO.Path]::GetTempPath()) "am-android-assets-$PID-$VariantName"
  if (Test-Path -LiteralPath $targetRoot) {
    Remove-Item -LiteralPath $targetRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
  Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($sourceRoot.Length).TrimStart('\')
    $destination = Join-Path $targetRoot $relative
    $destinationDir = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    [System.IO.File]::WriteAllBytes(
      $destination,
      [System.IO.File]::ReadAllBytes($_.FullName)
    )
  }
  $script:temporaryAssetDirs += $targetRoot
  $env:AM_ANDROID_ASSET_DIR = $targetRoot
}

function Set-AndroidVariantFiles {
  param([object]$Variant)

  $appId = "$($config.baseAppId)$($Variant.appIdSuffix)"

  $cap = $originalCapacitor | ConvertFrom-Json
  $cap.appId = $appId
  $cap.appName = [string]$Variant.name
  if ($cap.PSObject.Properties.Name -contains "appVersion") {
    $cap.appVersion = $version
  } else {
    $cap | Add-Member -NotePropertyName "appVersion" -NotePropertyValue $version
  }
  Set-TextNoBom -Path $capacitorPath -Value ($cap | ConvertTo-Json -Depth 8)

  $gradle = $originalGradle
  $gradle = $gradle -replace 'applicationId\s+"[^"]+"', "applicationId `"$appId`""
  $gradle = $gradle -replace 'versionCode\s+\d+', "versionCode $versionCode"
  $gradle = $gradle -replace 'versionName\s+"[^"]+"', "versionName `"$version`""
  Set-TextNoBom -Path $gradlePath -Value $gradle

  $strings = $originalStrings
  $strings = $strings -replace '<string name="app_name">.*?</string>', "<string name=`"app_name`">$($Variant.name)</string>"
  $strings = $strings -replace '<string name="title_activity_main">.*?</string>', "<string name=`"title_activity_main`">$($Variant.name)</string>"
  $strings = $strings -replace '<string name="package_name">.*?</string>', "<string name=`"package_name`">$appId</string>"
  $strings = $strings -replace '<string name="custom_url_scheme">.*?</string>', "<string name=`"custom_url_scheme`">$appId</string>"
  Set-TextNoBom -Path $stringsPath -Value $strings
  Set-AndroidVariantIcon -Variant $Variant
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Push-Location $root
try {
  foreach ($variantName in $variantNames) {
    $variant = $config.variants.$variantName
    if (-not $variant) {
      throw "Missing app variant '$variantName' in $configPath"
    }

    Write-Host "Building Android app variant: $($variant.name)"
    $env:VITE_APP_VARIANT = $variantName
    Set-AndroidVariantFiles -Variant $variant

    Invoke-CheckedNative npm run build:web:raw
    Invoke-CheckedNative node scripts/verify_built_assets.cjs dist
    Clear-CapacitorWebAssets
    Invoke-CheckedNative npx cap sync android
    Invoke-CheckedNative node scripts/verify_built_assets.cjs android
    Convert-CapacitorAssetsToRegularFiles
    Copy-CapacitorAssetsToLocalBuildDir -VariantName $variantName
    Clear-CapacitorGeneratedBuild

    Push-Location (Join-Path $root "android")
    try {
      Invoke-CheckedNative .\gradlew.bat assembleDebug
    }
    finally {
      Pop-Location
    }

    $apk = Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
    if (-not (Test-Path -LiteralPath $apk)) {
      throw "Expected APK was not created: $apk"
    }
    Get-ChildItem -LiteralPath $outputDir -Filter "$($variant.artifactPrefix)-Android-v*-debug.apk" -File -ErrorAction SilentlyContinue |
      Remove-Item -Force
    $target = Join-Path $outputDir "$($variant.artifactPrefix)-Android-v$version-debug.apk"
    Copy-Item -LiteralPath $apk -Destination $target -Force
    Write-Host "Copied $target"
  }
}
finally {
  Remove-Item Env:\VITE_APP_VARIANT -ErrorAction SilentlyContinue
  Remove-Item Env:\AM_ANDROID_ASSET_DIR -ErrorAction SilentlyContinue
  Set-TextNoBom -Path $capacitorPath -Value $originalCapacitor
  Set-TextNoBom -Path $gradlePath -Value $originalGradle
  Set-TextNoBom -Path $stringsPath -Value $originalStrings
  Set-AndroidVariantIcon -Variant $config.variants.main
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  foreach ($temporaryAssetDir in $temporaryAssetDirs) {
    $resolvedTemporary = [System.IO.Path]::GetFullPath($temporaryAssetDir)
    if ($resolvedTemporary.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $resolvedTemporary)) {
      Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  Pop-Location
}
