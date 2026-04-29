@echo off
echo Stopping Finance Hub...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5000') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo Done.
timeout /t 1 /nobreak > nul