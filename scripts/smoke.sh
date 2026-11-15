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
last_move() { curl -sS "$BASE/board.svg" | grep -o 'Last move: [^<]*' || true; }
fail() { echo "FAIL: $*" >&2; exit 1; }

# tap <label> <x,y> <expected "303" or "200:<h1 text>"> [curl args...]
tap() {
  local who=$1 point=$2 expected=$3 body got
  shift 3
  body=$(mktemp)
  got=$(curl -sS -o "$body" -w '%{http_code}' "$@" "$BASE/tap?$point")
  [ "$got" = 200 ] && got="200:$(grep -o '<h1>[^<]*' "$body" | sed 's/<h1>//')"
  rm -f "$body"
  printf '%-9s tap %-8s -> %s\n' "$who" "$point" "$got"
  [ "$got" = "$expected" ] || fail "$who tap $point expected '$expected', got '$got'"
}

# Asserts that a rejected tap leaves the board exactly as it was.
rejected() {
  local before
  before=$(curl -sS "$BASE/board.svg")
  tap "$@"
  [ "$(curl -sS "$BASE/board.svg")" = "$before" ] || fail "rejected tap $2 changed the board"
}

[ -z "$(last_move)" ] || fail "needs a fresh game; stop dev and delete .alchemy/local/profile-chess-Game"
echo "board: $(headline)"
rejected crawler 288,416 303

if headline | grep -q "You play White"; then
  visitors=(visitors "${CLICK[@]}") owner=(owner "${CLICK[@]}" -H "cookie: $OWNER")
  first=("${visitors[@]}") second=("${owner[@]}")
  from1=288,416 to1=288,288 from2=288,96 to2=288,224
  first_wait="200:It's the visitors' move." second_wait="200:It's Justin's move."
else
  owner=(owner "${CLICK[@]}" -H "cookie: $OWNER") visitors=(visitors "${CLICK[@]}")
  first=("${owner[@]}") second=("${visitors[@]}")
  from1=224,96 to1=224,224 from2=224,416 to2=224,288
  first_wait="200:It's Justin's move." second_wait="200:It's the visitors' move."
fi

rejected "${second[0]}" "$from2" "$first_wait" "${second[@]:1}"
tap "${first[0]}" "$from1" 303 "${first[@]:1}"
tap "${first[0]}" "$to1" 303 "${first[@]:1}"
echo "board: $(headline)"
rejected "${first[0]}" "$from2" "$second_wait" "${first[@]:1}"
tap "${second[0]}" "$from2" 303 "${second[@]:1}"
tap "${second[0]}" "$to2" 303 "${second[@]:1}"
echo "board: $(headline)"
[ "$(last_move)" = "Last move: 1... e5" ] || fail "expected 1. e4 e5, board shows '$(last_move)'"
echo "PASS: 1. e4 e5"
