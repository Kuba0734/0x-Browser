; Registers 0x Browser as a web browser so it shows up in Windows "Default apps".
; Windows only lets the user pick the default there; apps cannot set it themselves.
!macro customInstall
  WriteRegStr HKCU "Software\Classes\0xBrowserURL" "" "0x Browser URL"
  WriteRegStr HKCU "Software\Classes\0xBrowserURL" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\0xBrowserURL\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\0xBrowserURL\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\0xBrowserHTML" "" "0x Browser Document"
  WriteRegStr HKCU "Software\Classes\0xBrowserHTML\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\0xBrowserHTML\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr HKCU "Software\Clients\StartMenuInternet\0x Browser" "" "0x Browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\0x Browser\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\0x Browser\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\0x Browser\Capabilities" "ApplicationName" "0x Browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\0x Browser\Capabilities" "ApplicationDescription" "Minimal, performance-focused desktop browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\0x Browser\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\0x Browser\Capabilities\URLAssociations" "http" "0xBrowserURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\0x Browser\Capabilities\URLAssociations" "https" "0xBrowserURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\0x Browser\Capabilities\FileAssociations" ".html" "0xBrowserHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\0x Browser\Capabilities\FileAssociations" ".htm" "0xBrowserHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\0x Browser\Capabilities\FileAssociations" ".xhtml" "0xBrowserHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\0x Browser\Capabilities\FileAssociations" ".pdf" "0xBrowserHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\0x Browser\Capabilities\FileAssociations" ".svg" "0xBrowserHTML"
  WriteRegStr HKCU "Software\RegisteredApplications" "0x Browser" "Software\Clients\StartMenuInternet\0x Browser\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

; Updates run the old uninstaller first; keeping the keys then keeps the user's default choice valid.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\0xBrowserURL"
    DeleteRegKey HKCU "Software\Classes\0xBrowserHTML"
    DeleteRegKey HKCU "Software\Clients\StartMenuInternet\0x Browser"
    DeleteRegValue HKCU "Software\RegisteredApplications" "0x Browser"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${endIf}
!macroend
