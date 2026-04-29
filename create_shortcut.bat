@echo off
set SCRIPT_DIR=%~dp0
set SHORTCUT_PATH=%USERPROFILE%\Desktop\Finance Hub.lnk

powershell -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$s = $ws.CreateShortcut('%SHORTCUT_PATH%'); " ^
  "$s.TargetPath = '%SCRIPT_DIR%launch.bat'; " ^
  "$s.WorkingDirectory = '%SCRIPT_DIR%'; " ^
  "$s.WindowStyle = 1; " ^
  "$s.Description = 'Finance Hub - Personal Finance Tracker'; " ^
  "$s.Save()"

echo Desktop shortcut created at %SHORTCUT_PATH%
pause