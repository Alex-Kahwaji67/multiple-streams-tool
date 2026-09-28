#Requires AutoHotkey v2.0
#SingleInstance Force

; F7 through F10 select Desktops 1 through 4. Native Windows shortcuts are unchanged.
; The companion browser extension sets explicit per-tab mute states.
; Ctrl+Shift+7/8/9/0 are its global extension commands.
if A_Args.Length && A_Args[1] = "--self-test" {
    SelfTest()
    ExitApp
}
A_IconTip := "Multiple Streams: F7 / F8 / F9 / F10"
A_TrayMenu.Add("Stop stream switcher", (*) => ExitApp())
DetectHiddenWindows(true)
SetKeyDelay(10, 10)
Hotkey("F7", (*) => Choose(1, "7", "F7"))
Hotkey("F8", (*) => Choose(2, "8", "F8"))
Hotkey("F9", (*) => Choose(3, "9", "F9"))
Hotkey("F10", (*) => Choose(4, "0", "F10"))

Choose(desktop, command, key) {
    ; Critical serializes a burst of key presses; holding a key is coalesced.
    Critical("On")
    try {
        if !(WinExist("ahk_exe comet.exe") || WinExist("ahk_exe chrome.exe") || WinExist("ahk_exe msedge.exe"))
            throw Error("Open your streams in the browser with the extension installed first.")
        if GetKeyState("Ctrl", "P") || GetKeyState("Alt", "P") || GetKeyState("Shift", "P") || GetKeyState("LWin", "P") || GetKeyState("RWin", "P")
            throw Error("Release modifier keys, then try again.")
        GoToDesktop(desktop)
        ; This is NOT a browser mute toggle. It calls our explicit extension command.
        SendEvent("^+" command)
    } catch as error {
        TrayTip(error.Message, "Multiple Streams Tool")
    } finally {
        Critical("Off")
    }
    KeyWait(key)
}

ReadDesktops() {
    path := "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops"
    ; AutoHotkey returns REG_BINARY as hex: one GUID = 32 characters.
    ids := RegRead(path, "VirtualDesktopIDs")
    current := RegRead(path, "CurrentVirtualDesktop")
    return ParseDesktops(ids, current)
}

ParseDesktops(ids, current) {
    if !RegExMatch(ids, "i)^(?:[0-9a-f]{32})+$") || !RegExMatch(current, "i)^[0-9a-f]{32}$")
        throw Error("Windows desktop information is unavailable.")
    count := StrLen(ids) // 32
    Loop count {
        if SubStr(ids, (A_Index - 1) * 32 + 1, 32) = current
            return {count: count, index: A_Index, ids: ids}
    }
    throw Error("Cannot identify the current desktop. Try normal Windows desktop switching.")
}

GoToDesktop(target) {
    initial := ReadDesktops()
    if target < 1 || target > initial.count
        throw Error("Create Desktop " target " in Windows Task View first.")
    ; Bind the destination GUID so a desktop reordering does not redirect us.
    destination := SubStr(initial.ids, (target - 1) * 32 + 1, 32)
    Loop initial.count + 1 {
        state := ReadDesktops()
        position := ParseDesktops(state.ids, destination).index
        if state.index = position
            return
        ; Refuse to interfere with a manually held modifier.
        if GetKeyState("Ctrl", "P") || GetKeyState("Alt", "P") || GetKeyState("Shift", "P") || GetKeyState("LWin", "P") || GetKeyState("RWin", "P")
            throw Error("Release the modifier keys, then press F7-F10 again.")
        SendInput(state.index > position ? "^#{Left}" : "^#{Right}")
        started := A_TickCount
        Loop {
            Sleep(10)
            after := ReadDesktops()
            if after.index != state.index
                break
            if A_TickCount - started > 1500
                throw Error("Windows did not switch desktops. Try the shortcut again.")
        }
        ; Keep Windows' animation settings unchanged.
        Sleep(200)
    }
    throw Error("Desktop layout changed while switching. Try again.")
}

SelfTest() {
    ids := "11111111111111111111111111111111222222222222222222222222222222223333333333333333333333333333333344444444444444444444444444444444"
    Loop 4 {
        current := A_Index
        result := ParseDesktops(ids, SubStr(ids, (current - 1) * 32 + 1, 32))
        if result.index != current || result.count != 4
            throw Error("Desktop parsing failed.")
        Loop 4 {
            target := A_Index
            direction := result.index = target ? 0 : result.index > target ? -1 : 1
            expected := current = target ? 0 : current > target ? -1 : 1
            if direction != expected
                throw Error("F7-F10 direction failed.")
        }
    }
    rejected := false
    try ParseDesktops(ids, "00000000000000000000000000000000")
    catch
        rejected := true
    if !rejected
        throw Error("Unknown desktop was accepted.")
    FileAppend("PASS: 4 desktops, F7-F10 direction, same-desktop no-op, unknown desktop rejection. No hotkeys or desktop switches executed.`n", "*")
}
