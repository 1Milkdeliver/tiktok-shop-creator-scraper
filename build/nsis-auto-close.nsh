; Never terminate a collection/database write to perform an upgrade.
; quitAndInstall normally exits the app first. Allow that exit to finish,
; otherwise refuse installation so the user can save/stop and retry.
!macro customInit
  ; Bounded wait for normal application shutdown (max ~10s).
  StrCpy $R1 0
  ${Do}
    nsProcess::_FindProcess "TikTokShop达人抓取.exe" $R0
    ${If} $R0 != 0
      ${ExitDo}
    ${EndIf}
    IntOp $R1 $R1 + 1
    ${If} $R1 > 10
      ${ExitDo}
    ${EndIf}
    Sleep 1000
  ${Loop}
  ${If} $R0 == 0
    IfSilent creatorRequireExit
    MessageBox MB_OK|MB_ICONEXCLAMATION "请先在软件中停止任务、保存进度并退出，再重新运行安装包。为保护已有数据，本次安装不会强制关闭软件。"
    creatorRequireExit:
    SetErrorLevel 2
    Abort
  ${EndIf}
!macroend
