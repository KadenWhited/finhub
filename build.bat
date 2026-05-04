@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM  build.bat — Build MoneyRight.exe
REM  Run from the project root: .\build.bat
REM ─────────────────────────────────────────────────────────────────────────────

echo.
echo  Money Right — Build Script
echo  ══════════════════════════
echo.

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Python not found. Install Python 3.11+ and try again.
    pause & exit /b 1
)

REM Check virtual environment
if not exist "venv\Scripts\activate.bat" (
    echo  ERROR: venv not found. Run: python -m venv venv ^&^& venv\Scripts\activate ^&^& pip install -r requirements.txt
    pause & exit /b 1
)

REM Activate venv
call venv\Scripts\activate.bat

REM Install/update build dependencies
echo  Installing build dependencies...
pip install pyinstaller waitress --quiet

REM Check UPX (optional — reduces exe size)
where upx >nul 2>&1
if errorlevel 1 (
    echo  NOTE: UPX not found — exe will be larger. Download from upx.github.io
) else (
    echo  UPX found — exe will be compressed
)

REM Clean previous build
echo  Cleaning previous build...
if exist "dist\MoneyRight.exe" del /f "dist\MoneyRight.exe"
if exist "build" rmdir /s /q build

REM Run PyInstaller
echo  Building executable...
echo.
pyinstaller moneyright.spec --clean

if errorlevel 1 (
    echo.
    echo  BUILD FAILED — check output above for errors
    echo  Common fixes:
    echo    - Add missing imports to moneyright.spec hiddenimports
    echo    - Check build\MoneyRight\warn-MoneyRight.txt for warnings
    pause & exit /b 1
)

REM Check output
if not exist "dist\MoneyRight.exe" (
    echo  BUILD FAILED — MoneyRight.exe not found in dist\
    pause & exit /b 1
)

REM Get file size
for %%A in ("dist\MoneyRight.exe") do set EXE_SIZE=%%~zA
set /a EXE_MB=%EXE_SIZE% / 1048576

echo.
echo  ══════════════════════════════════════════
echo   BUILD SUCCESSFUL
echo   dist\MoneyRight.exe  (%EXE_MB% MB)
echo  ══════════════════════════════════════════
echo.

REM Create distribution zip
echo  Creating distribution package...
call :create_dist

echo.
echo  Distribution ready: dist\MoneyRight-dist.zip
echo.
pause
exit /b 0


:create_dist
REM Create dist folder structure
if exist "dist\MoneyRight-package" rmdir /s /q "dist\MoneyRight-package"
mkdir "dist\MoneyRight-package"

REM Copy files
copy "dist\MoneyRight.exe"  "dist\MoneyRight-package\"
copy ".env.example"         "dist\MoneyRight-package\.env.example"
copy "version.txt"          "dist\MoneyRight-package\version.txt"
copy "SETUP_GUIDE.txt"      "dist\MoneyRight-package\README.txt" 2>nul

REM Zip it (requires PowerShell 5+)
powershell -Command "Compress-Archive -Path 'dist\MoneyRight-package\*' -DestinationPath 'dist\MoneyRight-dist.zip' -Force"
exit /b 0
