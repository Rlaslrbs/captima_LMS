# 문제노트 서버 상태를 한 번에 점검해서 찍는다. 읽기만 한다 (고치지 않는다).
# 비밀(관리자 경로·기기 번호·키)은 출력하지 않는다.
$ErrorActionPreference = "Continue"
$ROOT = "C:\문제노트"

"=== 1 로컬 health ==="
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:4000/health" -UseBasicParsing -TimeoutSec 10
  "$($r.StatusCode) $($r.Content)"
} catch { "실패: $($_.Exception.Message)" }

"=== 2 프로세스 ==="
$p = Get-Process node, cloudflared -ErrorAction SilentlyContinue
if ($p) {
  ($p | Select-Object Name, Id, @{n='MemMB'; e={[int]($_.WorkingSet64 / 1MB)}}, StartTime |
    Format-Table -AutoSize | Out-String).Trim()
} else { "node/cloudflared 없음" }

"=== 3 작업 스케줄러 ==="
(Get-ScheduledTask -TaskName "문제노트-시작", "문제노트-백업" -ErrorAction SilentlyContinue |
  Select-Object TaskName, State | Format-Table -AutoSize | Out-String).Trim()
(Get-ScheduledTaskInfo -TaskName "문제노트-백업" -ErrorAction SilentlyContinue |
  Select-Object LastRunTime, LastTaskResult, NextRunTime | Format-List | Out-String).Trim()

"=== 4 외부 주소 ==="
$m = Select-String -Path "$ROOT\data\logs\tunnel.err.log" -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($m) {
  $u = [regex]::Match($m.Line, "https://[a-z0-9-]+\.trycloudflare\.com").Value
  $u
  try {
    $r2 = Invoke-WebRequest -Uri "$u/health" -UseBasicParsing -TimeoutSec 20
    "외부 $($r2.StatusCode) $($r2.Content)"
  } catch { "외부 실패: $($_.Exception.Message)" }
} else { "로그에서 주소를 못 찾았어요" }

"=== 5 최근 백업 ==="
$b = Get-ChildItem "$ROOT\data\backups\nightly" -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 2
if ($b) {
  ($b | Select-Object Name, @{n='MB'; e={[math]::Round($_.Length / 1MB, 1)}}, LastWriteTime |
    Format-Table -AutoSize | Out-String).Trim()
} else { "백업 파일 없음" }

"=== 6 디스크·메모리 ==="
$d = Get-PSDrive C
"C 남은 용량: $([math]::Round($d.Free / 1GB, 1))GB"
$os = Get-CimInstance Win32_OperatingSystem
"남은 메모리: $([int]($os.FreePhysicalMemory / 1024))MB / 전체 $([int]($os.TotalVisibleMemorySize / 1024))MB"

"=== 7 서버 오류 로그 (마지막 20줄) ==="
if (Test-Path "$ROOT\data\logs\server.err.log") {
  $t = Get-Content "$ROOT\data\logs\server.err.log" -Tail 20 -ErrorAction SilentlyContinue
  if ($t) { $t } else { "(비어 있음)" }
} else { "(파일 없음)" }
