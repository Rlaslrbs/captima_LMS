#!/bin/zsh
# 베타 시험용: 맥에서 서버 + Cloudflare Tunnel을 함께 켠다. 끄려면 Ctrl+C.
# - 켜 있는 동안 맥이 잠들지 않게 한다 (caffeinate).
# - 바깥 주소(https://○○.trycloudflare.com)는 켤 때마다 바뀐다. 아래에 나오는 주소를 테스터에게 보내면 된다.
# - 관리자 화면은 이 맥에서만 열린다: http://127.0.0.1:4000/<비밀주소>/
cd "${0:A:h}/.." || exit 1
LOG=data/tunnel.log

if lsof -tiTCP:4000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "4000 포트에 이미 서버가 켜져 있어요. 그 서버를 그대로 써요."
else
  node server/server.js &
  SERVER_PID=$!
  sleep 1
fi

tools/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4000 >"$LOG" 2>&1 &
TUNNEL_PID=$!
caffeinate -dis -w $TUNNEL_PID &

cleanup() { kill $TUNNEL_PID ${SERVER_PID:-} 2>/dev/null; echo "\n껐어요."; exit 0; }
trap cleanup INT TERM

for i in {1..30}; do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1)
  [[ -n $URL ]] && break
  sleep 1
done
if [[ -z $URL ]]; then echo "Tunnel 주소를 받지 못했어요. $LOG 를 확인해 주세요."; cleanup; fi

echo ""
echo "  테스터에게 보낼 주소   $URL"
echo "  관리자 (이 맥에서만)   http://127.0.0.1:4000/$(cat data/admin_path.txt)/"
echo ""
echo "  끄려면 Ctrl+C"
wait $TUNNEL_PID
