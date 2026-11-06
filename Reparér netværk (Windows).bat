@echo off
chcp 65001 >nul
title BanditBoard Live - reparér netværk
echo Åbner netværket for BanditBoard Live igen. Klik "Ja", når Windows spørger.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0tillad-netvaerk.ps1\"'"
echo.
echo Færdig. Start BanditBoard Live igen, og test fra telefonen med adressen + test
pause
