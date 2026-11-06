@echo off
chcp 65001 >nul
title BanditBoard Live
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if not exist "node_modules\express" (
  echo Installerer BanditBoard Live - det tager et øjeblik...
  call npm install --omit=dev --no-audit --no-fund
)

netsh advfirewall firewall show rule name="BanditBoard Live" >nul 2>&1
if errorlevel 1 (
  echo Første gang: Windows spørger om lov til at åbne netværket for tablets, telefoner og TV. Klik "Ja".
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0tillad-netvaerk.ps1\"'"
)

node server.js
echo.
echo BanditBoard Live er stoppet.
pause
exit /b

:nonode
echo Node.js er ikke installeret. Det skal kun gøres én gang.
echo.
where winget >nul 2>nul
if errorlevel 1 goto manual
echo Installerer Node.js automatisk...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
echo.
echo Færdig. Luk dette vindue og dobbeltklik på "Start BanditBoard Live" igen.
pause
exit /b

:manual
echo Åbner download-siden. Vælg "Windows Installer (LTS)", installer, og start BanditBoard Live igen.
start "" "https://nodejs.org/"
pause
