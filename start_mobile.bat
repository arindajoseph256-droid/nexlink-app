@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is required. Install Node.js LTS from https://nodejs.org/
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo npm was not found. Reinstall Node.js LTS and make sure it is on PATH.
    pause
    exit /b 1
)

if not exist "mobile-app\package.json" (
    echo mobile-app\package.json was not found.
    pause
    exit /b 1
)

rem Start Django in a separate window so phones on the same Wi-Fi can connect.
start "NEXLINK Django" cmd /k call "%~dp0start_server.bat" network

echo.
echo Installing mobile packages when needed...
cd /d "%~dp0mobile-app"
if not exist "node_modules" (
    call npm install
    if errorlevel 1 (
        echo.
        echo Mobile package installation failed.
        pause
        exit /b 1
    )
)

set "API_IP="
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /R /C:"IPv4 Address" /C:"IPv4-Adresse"') do if not defined API_IP set "API_IP=%%A"
set "API_IP=%API_IP: =%"
if not defined API_IP set "API_IP=127.0.0.1"

set "EXPO_PUBLIC_API_URL=http://%API_IP%:8000"
echo Mobile API URL: %EXPO_PUBLIC_API_URL%
echo.
echo Starting Expo. Scan the QR code with Expo Go.
call npm start

endlocal
