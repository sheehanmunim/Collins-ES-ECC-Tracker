@echo off
where git >nul 2>&1
if errorlevel 1 (
  echo Git is not installed or not on PATH. Starting the installed version.
) else if exist "%~dp0.git" (
  echo Checking GitHub for updates...
  git -C "%~dp0." pull --ff-only origin main
  if errorlevel 1 echo Automatic update could not be applied. Starting the installed version.
)
echo Preparing PowerShell execution policy for this user...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force } catch { Write-Warning ('Could not set CurrentUser execution policy: ' + $_.Exception.Message) }"
echo Unblocking local launcher files...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $root = '%~dp0'; Get-ChildItem -LiteralPath $root -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue; foreach ($folder in @('scripts', 'config')) { $path = Join-Path $root $folder; if (Test-Path -LiteralPath $path) { Get-ChildItem -LiteralPath $path -File -Recurse -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue } } } catch { Write-Warning ('Could not unblock local launcher files: ' + $_.Exception.Message) }"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1" %*
