# デスクトップ / スタートアップ にショートカットを作成する (ターミナルを出さずに起動)
param([switch]$Startup)
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { Write-Error "electron.exe が見つかりません。先に npm install を実行してください。"; exit 1 }

$shell = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Desktop'))
if ($Startup) { $targets += [Environment]::GetFolderPath('Startup') }
foreach ($dir in $targets) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'Topmost Clock.lnk'))
  $lnk.TargetPath = $electron
  $lnk.Arguments = '"' + $root + '"'
  $lnk.WorkingDirectory = $root
  $lnk.Description = 'Topmost Clock (時計・天気・雨雲レーダー・地震速報)'
  $lnk.Save()
  Write-Host "作成: $($lnk.FullName)"
}
