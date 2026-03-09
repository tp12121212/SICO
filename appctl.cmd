@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "DEBUG=0"
set "ACTION="
set "APP_URL=http://localhost:5173"

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

set "STATE_DIR=%ROOT_DIR%\.appctl"
set "LOG_DIR=%STATE_DIR%\logs"
set "PID_DIR=%STATE_DIR%\pids"
set "DASHBOARD_DIR=%ROOT_DIR%\dashboard"
set "WORKER_DIR=%ROOT_DIR%\worker"

if not exist "%STATE_DIR%" mkdir "%STATE_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
if not exist "%PID_DIR%" mkdir "%PID_DIR%"

if "%~1"=="" goto :usage
call :parse_args %*
if not defined ACTION goto :usage
if /I "%ACTION%"=="start" goto :start_all
if /I "%ACTION%"=="stop" goto :stop_all
if /I "%ACTION%"=="restart" goto :restart_all
goto :usage

:parse_args
if "%~1"=="" goto :eof
if /I "%~1"=="--debug" (
  set "DEBUG=1"
  shift
  goto :parse_args
)
if /I "%~1"=="start" (
  set "ACTION=start"
  shift
  goto :parse_args
)
if /I "%~1"=="stop" (
  set "ACTION=stop"
  shift
  goto :parse_args
)
if /I "%~1"=="restart" (
  set "ACTION=restart"
  shift
  goto :parse_args
)
goto :usage

:start_component
set "NAME=%~1"
set "WORKDIR=%~2"
set "COMMAND=%~3"
set "PIDFILE=%PID_DIR%\%NAME%.pid"

if exist "%PIDFILE%" (
  set /p EXISTING_PID=<"%PIDFILE%"
  call :is_running "!EXISTING_PID!"
  if not errorlevel 1 (
    echo %NAME% already running (pid=!EXISTING_PID!)
    goto :eof
  )
)

echo Starting %NAME%...
if "%DEBUG%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c cd /d ""%WORKDIR%"" && %COMMAND%' -NoNewWindow -PassThru; Set-Content -Path '%PIDFILE%' -Value $p.Id"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c cd /d ""%WORKDIR%"" && %COMMAND%' -RedirectStandardOutput '%LOG_DIR%\%NAME%.log' -RedirectStandardError '%LOG_DIR%\%NAME%.log' -WindowStyle Hidden -PassThru; Set-Content -Path '%PIDFILE%' -Value $p.Id"
)

set /p NEW_PID=<"%PIDFILE%"
call :is_running "%NEW_PID%"
if errorlevel 1 (
  echo Failed to start %NAME%. Check %LOG_DIR%\%NAME%.log
  exit /b 1
)
echo %NAME% started (pid=%NEW_PID%)
goto :eof

:stop_component
set "NAME=%~1"
set "PIDFILE=%PID_DIR%\%NAME%.pid"
if not exist "%PIDFILE%" (
  echo %NAME% not running
  goto :eof
)

set /p PID=<"%PIDFILE%"
call :is_running "%PID%"
if errorlevel 1 (
  echo %NAME% not running
  del /q "%PIDFILE%" >nul 2>&1
  goto :eof
)

echo Stopping %NAME% (pid=%PID%)...
taskkill /PID %PID% /T /F >nul 2>&1
del /q "%PIDFILE%" >nul 2>&1
goto :eof

:is_running
tasklist /FI "PID eq %~1" | find /I "%~1" >nul
if errorlevel 1 (
  exit /b 1
)
exit /b 0

:start_all
call :start_component api "%ROOT_DIR%" "set MAX_JSON_BODY_MB=80&& set AAD_TENANT_ID=organizations&& set ALLOW_MULTI_TENANT=true&& set AAD_AUDIENCE=api://63eefc68-2d4b-45c0-a619-65b45c5fada9&& set REQUIRED_SCOPES=Capsule.Submit&& set ALLOW_DUMMY_WORKER_FALLBACK=false&& node server/index.js"
call :preflight_worker_modules
call :start_component worker "%WORKER_DIR%" "func start"
call :start_component dashboard "%DASHBOARD_DIR%" "npm run dev"
echo All components started.
if "%DEBUG%"=="1" (
  echo Debug mode enabled: component output is attached to this console.
) else (
  echo Logs: %LOG_DIR%
)
call :open_browser
goto :eof

:preflight_worker_modules
echo Preflighting worker module (ExchangeOnlineManagement)...
if "%DEBUG%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$repo = Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue; if ($repo) { Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue | Out-Null }; if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) { if (Get-Command -Name Install-Module -ErrorAction SilentlyContinue) { Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop | Out-Null } }; Import-Module ExchangeOnlineManagement -ErrorAction Stop | Out-Null; Write-Host 'ExchangeOnlineManagement preflight ready'" >nul 2>&1
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$repo = Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue; if ($repo) { Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue | Out-Null }; if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) { if (Get-Command -Name Install-Module -ErrorAction SilentlyContinue) { Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop | Out-Null } }; Import-Module ExchangeOnlineManagement -ErrorAction Stop | Out-Null; Write-Host 'ExchangeOnlineManagement preflight ready'" >>"%LOG_DIR%\worker-preflight.log" 2>&1
)
goto :eof

:open_browser
if /I "%NO_BROWSER%"=="1" (
  echo Skipping browser launch (NO_BROWSER enabled).
  goto :eof
)
if /I "%HEADLESS%"=="1" (
  echo Skipping browser launch (HEADLESS enabled).
  goto :eof
)
if /I "%CI%"=="1" (
  echo Skipping browser launch (CI enabled).
  goto :eof
)
timeout /t 5 /nobreak >nul
start "" "%APP_URL%"
goto :eof

:stop_all
call :stop_component dashboard
call :stop_component worker
call :stop_component api
echo All components stopped.
goto :eof

:restart_all
call :stop_all
call :start_all
goto :eof

:usage
echo Usage: %~n0 [--debug] ^<start^|stop^|restart^>
exit /b 1
