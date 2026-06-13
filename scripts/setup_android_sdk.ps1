$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$sdkRoot = Join-Path $root ".android-sdk"
$cmdlineZip = Join-Path $root ".android-sdk\cmdline-tools.zip"
$cmdlineRoot = Join-Path $sdkRoot "cmdline-tools"
$latestRoot = Join-Path $cmdlineRoot "latest"
$url = "https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip"

New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null

if (!(Test-Path (Join-Path $latestRoot "bin\sdkmanager.bat"))) {
  Write-Host "Downloading Android command line tools..."
  Invoke-WebRequest -Uri $url -OutFile $cmdlineZip
  $tmp = Join-Path $sdkRoot "_cmdline_tmp"
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp
  Expand-Archive -Path $cmdlineZip -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force -Path $cmdlineRoot | Out-Null
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $latestRoot
  Move-Item -LiteralPath (Join-Path $tmp "cmdline-tools") -Destination $latestRoot
  Remove-Item -Recurse -Force $tmp
}

$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:Path = "$env:JAVA_HOME\bin;$latestRoot\bin;$sdkRoot\platform-tools;$env:Path"

$sdkManager = Join-Path $latestRoot "bin\sdkmanager.bat"
Write-Host "Accepting Android SDK licenses..."
"y`ny`ny`ny`ny`ny`ny`ny`ny`ny`n" | & $sdkManager --licenses | Out-Host

Write-Host "Installing Android SDK packages..."
& $sdkManager "platform-tools" "platforms;android-35" "build-tools;35.0.0"

Write-Host "ANDROID_HOME=$sdkRoot"
