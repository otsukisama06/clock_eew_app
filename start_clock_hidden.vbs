Option Explicit

Dim shell, fso, scriptDir, pythonw, scriptPath, envFile, command, fileHandle, line, parts, processEnv
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
pythonw = scriptDir & "\\.venv\\Scripts\\pythonw.exe"
scriptPath = scriptDir & "\\clock_topmost.py"
envFile = scriptDir & "\\.env"

If Not fso.FileExists(pythonw) Then
    MsgBox "pythonw.exe が見つかりません: " & pythonw, vbExclamation, "Clock Launcher"
    WScript.Quit 1
End If

If Not fso.FileExists(scriptPath) Then
    MsgBox "clock_topmost.py が見つかりません: " & scriptPath, vbExclamation, "Clock Launcher"
    WScript.Quit 1
End If

' .env ファイルから環境変数を読み込む
Set processEnv = shell.Environment("PROCESS")
If fso.FileExists(envFile) Then
    Set fileHandle = fso.OpenTextFile(envFile)
    Do Until fileHandle.AtEndOfStream
        line = Trim(fileHandle.ReadLine())
        If Len(line) > 0 And Left(line, 1) <> "#" Then
            If InStr(line, "=") > 0 Then
                parts = Split(line, "=", 2)
                If UBound(parts) >= 1 Then
                    Dim varName, varValue
                    varName = Trim(parts(0))
                    varValue = Trim(parts(1))
                    If Len(varName) > 0 And Len(varValue) > 0 Then
                        processEnv(varName) = varValue
                    End If
                End If
            End If
        End If
    Loop
    fileHandle.Close()
End If

command = Chr(34) & pythonw & Chr(34) & " " & Chr(34) & scriptPath & Chr(34)
shell.Run command, 0, False
