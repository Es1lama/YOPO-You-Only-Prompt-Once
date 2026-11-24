@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Yo-po - You Only Prompt Once
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer from https://nodejs.org and open Yo-po again.
  pause
  exit /b 1
)
set "action=setup"
if /i "%~1"=="configure-api" set "action=configure-api"
node bin\yo-po.js %action% --window
set "result=%errorlevel%"
if not "%result%"=="0" (
  echo Use npm start in an interactive terminal to open the command-line setup.
  pause
)
exit /b %result%
