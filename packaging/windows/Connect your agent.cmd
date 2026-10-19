@echo off
rem Prints MCP settings for this folder. It only prints; it changes no configuration file.
setlocal
title Pixelbolt: connect your agent
if not exist "%~dp0runtime\node.exe" goto incomplete
"%~dp0runtime\node.exe" "%~dp0launcher\connect.mjs" %*
if errorlevel 1 (
  if "%~1"=="" pause
  exit /b 1
)
if not "%~1"=="" exit /b 0
echo.
pause
exit /b 0

:incomplete
echo This helper cannot find runtime\node.exe next to this file.
echo.
echo Extract the whole ZIP first: right-click it, choose "Extract All", then
echo run "Connect your agent.cmd" in the extracted folder.
echo.
pause
exit /b 1
