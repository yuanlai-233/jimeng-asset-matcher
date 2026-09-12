@echo off
setlocal
chcp 65001 >nul
py -3 -c "import sys;sys.exit(0 if sys.version_info >= (3,9) else 1)" >nul 2>&1
if not errorlevel 1 goto use_py
python -c "import sys;sys.exit(0 if sys.version_info >= (3,9) else 1)" >nul 2>&1
if not errorlevel 1 goto use_python
echo Python 3.9+ is required. See README.md, or load assets/extension manually.
set "task_install_status=1"
goto done
:use_py
py -3 "%~dp0scripts\install.py" --open %*
set "task_install_status=%errorlevel%"
goto done
:use_python
python "%~dp0scripts\install.py" --open %*
set "task_install_status=%errorlevel%"
:done
pause
exit /b %task_install_status%
