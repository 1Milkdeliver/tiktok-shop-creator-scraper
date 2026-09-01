; Auto-close every running instance of the app before install/update,
; so users never see "TikTok Shop 达人采集 cannot be closed" during upgrades.
; Uses taskkill /f /t (force + process tree) and waits until the process is gone.
!macro customInit
  ; kill all app processes (main + renderer + gpu children) forcefully
  nsExec::ExecToStack 'taskkill /f /t /im "TikTok Shop 达人采集.exe"'
  Pop $0 ; exit code
  Pop $1 ; output (ignore)

  ; wait until the process is fully gone (max ~10s), then let electron-builder
  ; proceed without hitting its "cannot be closed" dialog
  StrCpy $R1 0
  ${Do}
    nsProcess::_FindProcess "TikTok Shop 达人采集.exe" $R0
    ${If} $R0 != 0
      ${ExitDo}
    ${EndIf}
    IntOp $R1 $R1 + 1
    ${If} $R1 > 10
      ${ExitDo}
    ${EndIf}
    Sleep 1000
  ${Loop}
!macroend
