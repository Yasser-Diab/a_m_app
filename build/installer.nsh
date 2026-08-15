!macro closeEasyCommercialProcesses
  DetailPrint "Closing any running Easy Commercial / Accounting Management process..."

  IfFileExists "$INSTDIR\Easy Commercial.exe" 0 ec_skip_current_shutdown
    Exec '"$INSTDIR\Easy Commercial.exe" --shutdown-for-update'
  ec_skip_current_shutdown:

  IfFileExists "$INSTDIR\Accounting Management.exe" 0 ec_skip_legacy_shutdown
    Exec '"$INSTDIR\Accounting Management.exe" --shutdown-for-update'
  ec_skip_legacy_shutdown:

  IfFileExists "$LOCALAPPDATA\Programs\Easy Commercial\Easy Commercial.exe" 0 ec_skip_local_current_shutdown
    Exec '"$LOCALAPPDATA\Programs\Easy Commercial\Easy Commercial.exe" --shutdown-for-update'
  ec_skip_local_current_shutdown:

  IfFileExists "$LOCALAPPDATA\Programs\Accounting Management\Accounting Management.exe" 0 ec_skip_local_legacy_shutdown
    Exec '"$LOCALAPPDATA\Programs\Accounting Management\Accounting Management.exe" --shutdown-for-update'
  ec_skip_local_legacy_shutdown:

  Sleep 3500

  nsExec::ExecToLog 'taskkill /F /T /IM "Easy Commercial.exe"'
  nsExec::ExecToLog 'taskkill /F /T /IM "EasyCommercial.exe"'
  nsExec::ExecToLog 'taskkill /F /T /IM "Accounting Management.exe"'
  nsExec::ExecToLog 'taskkill /F /T /IM "AccountingManagement.exe"'

  Sleep 1200

  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference=''SilentlyContinue''; $$names=@(''Easy Commercial.exe'',''EasyCommercial.exe'',''Accounting Management.exe'',''AccountingManagement.exe''); $$roots=@(''$INSTDIR'',''$LOCALAPPDATA\Programs\Easy Commercial'',''$LOCALAPPDATA\Programs\Accounting Management'') | Where-Object { $$_ }; Get-CimInstance Win32_Process | Where-Object { $$proc=$$_; ($$names -contains $$proc.Name) -or ($$proc.Path -and (@($$roots | Where-Object { $$root=$$_; $$proc.Path.StartsWith($$root, ''CurrentCultureIgnoreCase'') }).Count -gt 0)) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'

  Sleep 1200
!macroend

!macro customCheckAppRunning
  !insertmacro closeEasyCommercialProcesses
!macroend

!macro customInit
  !insertmacro closeEasyCommercialProcesses
!macroend

!macro customUnInit
  !insertmacro closeEasyCommercialProcesses
!macroend
