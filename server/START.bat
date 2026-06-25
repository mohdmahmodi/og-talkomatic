@echo off
REM Start Talkomatic Server

cd /d "%~dp0"

echo Installing dependencies...
call npm install

echo.
echo Starting Talkomatic Server...
echo.

call npm start

pause
