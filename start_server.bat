@echo off
setlocal
cd /d "%~dp0"

rem Do not use .venv or venv here. Virtual environments are not portable
rem between computers because they contain absolute interpreter paths.
set "PYTHON_CMD="

where python >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=python"

if not defined PYTHON_CMD (
    where py >nul 2>&1
    if not errorlevel 1 set "PYTHON_CMD=py -3"
)

if not defined PYTHON_CMD (
    echo Python 3 is required. Install Python from https://www.python.org/downloads/
    echo Make sure "Add Python to PATH" is enabled during installation.
    pause
    exit /b 1
)

echo Checking Python dependencies...
%PYTHON_CMD% manage.py check >nul 2>&1
if errorlevel 1 (
    echo Installing missing Python dependencies...
    %PYTHON_CMD% -m pip install --user --disable-pip-version-check -r requirements.txt
    if errorlevel 1 (
        echo.
        echo Dependency installation failed.
        echo Check that Python and pip are installed, then try again.
        pause
        exit /b 1
    )
)

echo.
echo Applying database migrations...
%PYTHON_CMD% manage.py migrate

if errorlevel 1 (
    echo.
    echo Database migration failed.
    pause >nul
    exit /b 1
)

echo.
echo Starting Django development server at http://127.0.0.1:8000/
echo Keep this window open. Django will reload when backend files change.
set "SERVER_HOST=127.0.0.1"
if /i "%~1"=="network" set "SERVER_HOST=0.0.0.0"
%PYTHON_CMD% manage.py runserver %SERVER_HOST%:8000

if errorlevel 1 (
    echo.
    echo The server stopped with an error. Press any key to close this window.
    pause >nul
)
endlocal
