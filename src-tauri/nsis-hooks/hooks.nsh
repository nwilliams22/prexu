; Uncheck the "Create desktop shortcut" checkbox by default
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!macro NSIS_HOOK_PREINSTALL
  ; Kill any running Prexu processes before install/upgrade
  nsExec::ExecToLog 'taskkill /f /im "Prexu.exe"'
  ; Brief pause to let the process fully exit
  Sleep 500
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Auto-advance to finish page when installation completes
  SetAutoClose true
!macroend
