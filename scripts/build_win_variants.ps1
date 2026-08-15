param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$BuilderArguments
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$configPath = Join-Path $root "config\app-variants.json"
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json
$buildVersion = if ($config.version) { [string]$config.version } else { [string]$packageJson.version }
$variantNames = @("main")
$desktopOutput = if ($config.desktopOutput) { $config.desktopOutput } else { "dist-installer" }

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

function Remove-VariantOutput {
  param([object]$Variant)

  $outputName = if ($Variant.artifactPrefix) { [string]$Variant.artifactPrefix } else { "EasyCommercial" }
  $outputPath = Join-Path (Join-Path $root $desktopOutput) $outputName
  $resolvedRoot = [System.IO.Path]::GetFullPath((Join-Path $root $desktopOutput))
  $resolvedOutput = [System.IO.Path]::GetFullPath($outputPath)
  if (-not $resolvedOutput.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean unexpected output path: $resolvedOutput"
  }
  if (Test-Path -LiteralPath $resolvedOutput) {
    Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
  }
}

Push-Location $root
try {
  foreach ($variantName in $variantNames) {
    $variant = $config.variants.$variantName
    if (-not $variant) {
      throw "Missing app variant '$variantName' in $configPath"
    }

    Write-Host "Building Windows app variant: $($variant.name)"
    $env:VITE_APP_VARIANT = $variantName
    $env:AM_APP_VARIANT = $variantName
    $env:AM_BUILD_VERSION = $buildVersion
    $env:VITE_APP_VERSION = $buildVersion
    Remove-VariantOutput -Variant $variant
    Invoke-CheckedNative npm run build:web:raw
    Invoke-CheckedNative node scripts/verify_built_assets.cjs dist
    Invoke-CheckedNative npx electron-builder --win nsis --config electron-builder.variant.cjs @BuilderArguments
  }
}
finally {
  Remove-Item Env:\VITE_APP_VARIANT -ErrorAction SilentlyContinue
  Remove-Item Env:\AM_APP_VARIANT -ErrorAction SilentlyContinue
  Remove-Item Env:\AM_BUILD_VERSION -ErrorAction SilentlyContinue
  Remove-Item Env:\VITE_APP_VERSION -ErrorAction SilentlyContinue
  Pop-Location
}
