@echo off
echo Preparing PowerShell execution policy for this user...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force } catch { Write-Warning ('Could not set CurrentUser execution policy: ' + $_.Exception.Message) }"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1" %*
