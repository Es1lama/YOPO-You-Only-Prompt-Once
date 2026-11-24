@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0" || exit /b 1
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer to open the review chat.
  pause
  exit /b 1
)
echo Opening Yo-po review chat...
node bin\yo-po.js review-chat
set "result=%errorlevel%"
if not "%result%"=="0" pause
exit /b %result%
