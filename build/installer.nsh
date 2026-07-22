!macro customInit
  IfFileExists "$INSTDIR\Accounting Management.exe" 0 am_shutdown_done
  DetailPrint "Requesting Accounting Management to close..."
  Exec '"$INSTDIR\Accounting Management.exe" --shutdown-for-update'
  Sleep 3500
  nsExec::ExecToLog 'taskkill /IM "Accounting Management.exe" /T'
  Sleep 1000
  nsExec::ExecToLog 'taskkill /F /IM "Accounting Management.exe" /T'
am_shutdown_done:
!macroend
