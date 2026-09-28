@echo off
setlocal
set "AHK=%ProgramFiles%\AutoHotkey\v2\AutoHotkey64.exe"
if not exist "%AHK%" set "AHK=%LocalAppData%\Programs\AutoHotkey\v2\AutoHotkey64.exe"
if not exist "%AHK%" (
  echo Install AutoHotkey v2 from https://www.autohotkey.com/ then try again.
  echo If you chose a custom install folder, open Multiple-Streams.ahk with AutoHotkey v2.
  pause
  exit /b 1
)
start "" "%AHK%" "%~dp0Multiple-Streams.ahk"
