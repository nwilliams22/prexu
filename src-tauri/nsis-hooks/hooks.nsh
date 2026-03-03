!macro NSIS_HOOK_PREINSTALL
  ; Kill any running Prexu processes before install/upgrade
  nsExec::ExecToLog 'taskkill /f /im "Prexu.exe"'
  ; Brief pause to let the process fully exit
  Sleep 500
!macroend
