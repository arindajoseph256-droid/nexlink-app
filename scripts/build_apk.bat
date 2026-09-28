@echo off
setlocal
cd /d "%~dp0..\mobile-app"

echo ============================================================
echo  NEXLINK - Android APK build (via Expo EAS cloud builders)
echo  Free account required: https://expo.dev/signup
echo ============================================================.

where npm >nul 2>&1
if errorlevel 1 (
    echo npm was not found. Install Node.js LTS from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing packages...
    call npm install
    if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
)

echo Logging in to Expo (first run only)...
call npx eas-cli whoami >nul 2>&1
if errorlevel 1 (
    call npx eas-cli login
    if errorlevel 1 ( echo Login required. & pause & exit /b 1 )
)

echo.
echo Building release APK (cloud build, ~10-15 min)...
call npx eas-cli build --platform android --profile preview --non-interactive
if errorlevel 1 ( echo Build failed. & pause & exit /b 1 )

echo.
echo Done. Download the APK from the link printed above, then install it
echo on your phone (allow "Install unknown apps" when asked).
pause
endlocal
