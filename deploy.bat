@echo off
cd /d "%~dp0"
call npm run deploy
echo.
echo Done. Press any key to close.
pause >nul
