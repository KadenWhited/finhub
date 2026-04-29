@echo off
title Finance Hub
cd /d "%~dp0"

:: Check if venv exists, create if not
if not exist "venv\Scripts\activate.bat" (
    echo Setting up virtual environment...
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate.bat
)

:: Start the server in background
start /b python app.py > logs\server.log 2>&1

:: Wait for server to come up
timeout /t 2 /nobreak > nul

:: Open browser
start "" http://localhost:5000

echo Finance Hub is running at http://localhost:5000
echo Close this window to stop the server.
pause

mkdir logs