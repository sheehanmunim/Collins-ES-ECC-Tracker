param(
  [switch]$SetupOnly
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location -Path $Root

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-Command {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Add-CommonPath {
  param([string]$PathToAdd)
  if ((Test-Path $PathToAdd) -and ($env:Path -notlike "*$PathToAdd*")) {
    $env:Path = "$PathToAdd;$env:Path"
  }
}

function Refresh-LocalPath {
  Add-CommonPath "$env:ProgramFiles\nodejs"
  Add-CommonPath "$env:LOCALAPPDATA\Programs\Ollama"
}

function Test-NodeSupported {
  if (-not (Test-Command "node")) {
    return $false
  }

  $version = (& node --version).Trim().TrimStart("v")
  $major = [int]($version.Split(".")[0])
  return $major -ge 20
}

function Require-Winget {
  if (-not (Test-Command "winget")) {
    throw "This script can install missing tools on Windows with winget, but winget was not found. Install App Installer from the Microsoft Store, then rerun this script."
  }
}

function Install-WithWinget {
  param(
    [string]$PackageId,
    [string]$Name
  )

  Require-Winget
  Write-Step "Installing $Name"
  winget install --id $PackageId --exact --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "winget could not install $Name."
  }
  Refresh-LocalPath
}

Write-Host "Local CR Tracker bootstrap"
if ($SetupOnly) {
  Write-Host "This will install missing local prerequisites and pull Qwen."
} else {
  Write-Host "This will install missing local prerequisites, pull Qwen, and start the app."
}

Refresh-LocalPath

if (-not (Test-NodeSupported)) {
  Install-WithWinget -PackageId "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
}

Refresh-LocalPath

if (-not (Test-NodeSupported)) {
  throw "Node.js 20 or newer is required, and the automatic install did not make it available in this terminal. Reopen PowerShell and rerun this script."
}

if (-not (Test-Command "npm")) {
  throw "Node.js was installed, but npm is not available in this terminal yet. Close and reopen PowerShell, then rerun .\scripts\start-local.ps1."
}

if (-not (Test-Command "ollama")) {
  Install-WithWinget -PackageId "Ollama.Ollama" -Name "Ollama"
}

Refresh-LocalPath

if ($SetupOnly) {
  Write-Step "Running setup"
  npm run setup
} else {
  Write-Step "Starting the app"
  npm run local
}
