#!/usr/bin/env bash
# Plays the first move pair of a fresh game against a running `bun run dev` worker with browser-click headers.
# The owner cookie is minted from the local dev SESSION_SECRET, so this never touches GitHub.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE=${1:-http://localhost:1337}
CLICK=(-H 'sec-fetch-mode: navigate' -H 'sec-fetch-dest: document' -H 'referer: https://github.com/')
STAGE=${ALCHEMY_STAGE:-dev_$USER}
OWNER="session=$(STAGE=$STAGE bun -e '
  const state = JSON.parse(await Bun.file(`.alchemy/state/profile-chess/${process.env.STAGE}/SessionSecret.json`).text());
  const { signSession } = await import("./src/session.ts");
  console.log(await signSession(state.attr.text.__redacted__, Date.now() + 3_600_000));
')"

headline() { curl -sS "$BASE/board.svg" | grep -o 'font-weight="600"[^>]*>[^<]*' | sed 's/.*>//'; }

tap() {
  local who=$1 point=$2 body
  shift 2
  body=$(mktemp)
  printf '%-9s tap %-8s -> ' "$who" "$point"
  curl -sS -o "$body" -w '%{http_code} %{redirect_url}' "$@" "$BASE/tap?$point"
  printf '  %s\n' "$(grep -o '<h1>[^<]*' "$body" | sed 's/<h1>//')"
  rm -f "$body"
}

echo "board: $(headline)"
tap crawler 288,416
echo "board: $(headline)"

if headline | grep -q "You play White"; then
  first=(visitors "${CLICK[@]}") second=(owner "${CLICK[@]}" -H "cookie: $OWNER")
  from1=288,416 to1=288,288 from2=288,96 to2=288,224
else
  first=(owner "${CLICK[@]}" -H "cookie: $OWNER") second=(visitors "${CLICK[@]}")
  from1=224,96 to1=224,224 from2=224,416 to2=224,288
fi

tap "${second[0]}" "$from2" "${second[@]:1}"
tap "${first[0]}" "$from1" "${first[@]:1}"
echo "board: $(headline)"
tap "${first[0]}" "$to1" "${first[@]:1}"
echo "board: $(headline)"
tap "${first[0]}" "$from2" "${first[@]:1}"
tap "${second[0]}" "$from2" "${second[@]:1}"
tap "${second[0]}" "$to2" "${second[@]:1}"
echo "board: $(headline)"
curl -sS "$BASE/board.svg" | grep -o 'Last move: [^<]*'
