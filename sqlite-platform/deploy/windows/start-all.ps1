# 문제노트 서버 + Cloudflare Tunnel을 함께 켠다 (Windows)
# 사용법 (PowerShell):  .\deploy\windows\start-all.ps1
# 끄려면 이 창에서 Ctrl+C
#
# 설정은 아래 두 값만 바꾸면 된다.
#   $TunnelName : 고정 주소를 쓸 때 만든 터널 이름 (비워 두면 임시 주소로 켠다)
#   $Port       : 서버 포트 (기본 4000)

$ErrorActionPreference = "Stop"
$TunnelName = "munje-note"
$Port = 4000

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root
$LogDir = Join-Path $Root "data\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Cloudflared = Join-Path $Root "tools\bin\cloudflared.exe"

if (-not (Test-Path $Cloudflared)) {
    Write-Host "cloudflared.exe 가 없어요. $Cloudflared 에 받아 두세요. (안내 문서 2단계)" -ForegroundColor Red
    exit 1
}

# 1) 노트북이 잠들지 않게 한다 (이 창이 켜져 있는 동안)
Add-Type -Namespace Win -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
[void][Win.Power]::SetThreadExecutionState(0x80000001)   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED

# 2) 서버가 이미 켜져 있는지 확인
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    Write-Host "$Port 포트에 이미 서버가 켜져 있어요. 그 서버를 그대로 씁니다." -ForegroundColor Yellow
    $server = $null
} else {
    $env:HOST = "127.0.0.1"          # 바깥 접속은 Tunnel로만 받는다
    $env:PORT = "$Port"
    $server = Start-Process -FilePath "node" -ArgumentList "server\server.js" -WorkingDirectory $Root -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir "server.log") -RedirectStandardError (Join-Path $LogDir "server.err.log")
    Start-Sleep -Seconds 2
    if ($server.HasExited) {
        Write-Host "서버가 바로 꺼졌어요. $LogDir\server.err.log 를 확인하세요." -ForegroundColor Red
        exit 1
    }
}

# 3) Cloudflare Tunnel 켜기
$tunnelLog = Join-Path $LogDir "tunnel.log"
if ($TunnelName) {
    # 고정 주소: %USERPROFILE%\.cloudflared\config.yml 의 설정을 쓴다
    $tunnelArgs = "tunnel --no-autoupdate run $TunnelName"
} else {
    # 임시 주소: 켤 때마다 주소가 바뀐다
    $tunnelArgs = "tunnel --no-autoupdate --url http://127.0.0.1:$Port"
}
$tunnel = Start-Process -FilePath $Cloudflared -ArgumentList $tunnelArgs -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $tunnelLog -RedirectStandardError (Join-Path $LogDir "tunnel.err.log")

if (-not $TunnelName) {
    $url = $null
    for ($i = 0; $i -lt 30 -and -not $url; $i++) {
        Start-Sleep -Seconds 1
        $hit = Select-String -Path $tunnelLog, (Join-Path $LogDir "tunnel.err.log") -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) { $url = [regex]::Match($hit.Line, 'https://[a-z0-9-]+\.trycloudflare\.com').Value }
    }
    if ($url) { Write-Host "`n  테스터에게 보낼 주소: $url`n" -ForegroundColor Green }
    else { Write-Host "임시 주소를 받지 못했어요. $tunnelLog 를 확인하세요." -ForegroundColor Red }
} else {
    Write-Host "`n  고정 주소 터널($TunnelName)을 켰어요. 설정한 도메인으로 접속하세요.`n" -ForegroundColor Green
}

Write-Host "  관리자 화면은 이 노트북에서만 열려요: http://127.0.0.1:$Port/ (비밀 주소는 data\admin_path.txt)"
Write-Host "  끄려면 Ctrl+C`n"

# 4) 둘 중 하나라도 꺼지면 같이 정리하고 끝낸다
try {
    while (-not $tunnel.HasExited) {
        if ($server -and $server.HasExited) { Write-Host "서버가 꺼졌어요. 터널도 끕니다." -ForegroundColor Red; break }
        Start-Sleep -Seconds 5
    }
} finally {
    if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    [void][Win.Power]::SetThreadExecutionState(0x80000000)  # 잠들기 허용으로 되돌림
    Write-Host "껐어요."
}
