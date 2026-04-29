Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & WScript.ScriptFullName & chr(34), 0, False

Dim scriptDir
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
WshShell.Run "cmd /c """ & scriptDir & "launch.bat""", 1, False