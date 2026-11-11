# 작업 스케줄러 등록 (Windows) — 한 번만 실행하면 된다
# 사용법 (PowerShell을 '관리자 권한'으로 열고):  .\deploy\windows\register-tasks.ps1
#
# 등록되는 작업
#   1) 문제노트-시작 : 로그온할 때 start-all.ps1 실행 (서버 + 터널 자동 시작)
#   2) 문제노트-백업 : 매일 새벽 3시에 backup.mjs 실행

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$StartScript = Join-Path $PSScriptRoot "start-all.ps1"
$Node = (Get-Command node -ErrorAction Stop).Source
$Backup = Join-Path $PSScriptRoot "backup.mjs"

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

# 1) 시작 작업 (노트북 로그온 시)
$startAction = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`""
$startTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName "문제노트-시작" -Action $startAction -Trigger $startTrigger `
    -Settings $settings -RunLevel Limited -Force | Out-Null

# 2) 백업 작업 (매일 03:00)
$backupAction = New-ScheduledTaskAction -Execute $Node -Argument "`"$Backup`"" -WorkingDirectory $Root
$backupTrigger = New-ScheduledTaskTrigger -Daily -At 3:00AM
Register-ScheduledTask -TaskName "문제노트-백업" -Action $backupAction -Trigger $backupTrigger `
    -Settings $settings -RunLevel Limited -Force | Out-Null

Write-Host "등록 완료. 작업 스케줄러(taskschd.msc)에서 '문제노트-시작', '문제노트-백업'을 확인하세요."
Write-Host "지금 바로 시작하려면: Start-ScheduledTask -TaskName 문제노트-시작"
