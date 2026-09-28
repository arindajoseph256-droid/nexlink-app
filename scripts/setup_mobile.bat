@echo off
rem One-time setup: install Flutter-free mobile deps + check tooling.
setlocal
cd /d "%~dp0..\mobile-app"
where npm >nul 2>&1
if errorlevel 1 (
    echo npm not found. Install Node.js LTS from https://nodejs.org/
    pause & exit /b 1
)
echo Installing Nexlink mobile dependencies...
call npm install
if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
echo.
echo Setup complete. Use scripts\run_mobile.bat to develop,
echo or scripts\build_apk.bat to produce a release APK.
pause
endlocal
