#!/usr/bin/env bash
# Проверка контрактов API без реального ключа Groq.
# Поднимает мок Groq + API и прогоняет основные и ошибочные сценарии.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MOCK_PORT="${MOCK_PORT:-9099}"
API_PORT="${API_PORT:-8798}"
PASS=0
FAIL=0

log() { printf '%s\n' "$*"; }
check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == *"$expected"* ]]; then
    PASS=$((PASS + 1))
    log "  ok   $name"
  else
    FAIL=$((FAIL + 1))
    log "  FAIL $name"
    log "       ожидалось: $expected"
    log "       получено:  ${actual:0:300}"
  fi
}

cleanup() {
  [[ -n "${MOCK_PID:-}" ]] && kill "$MOCK_PID" 2>/dev/null
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT

log "→ поднимаю мок Groq на :$MOCK_PORT"
MOCK_PORT="$MOCK_PORT" npx tsx server/mock-groq.ts >/tmp/speacher-mock.log 2>&1 &
MOCK_PID=$!

log "→ поднимаю API на :$API_PORT"
GROQ_API_KEY=mock \
GROQ_BASE_URL="http://127.0.0.1:$MOCK_PORT/openai/v1" \
API_PORT="$API_PORT" \
npx tsx server/index.ts >/tmp/speacher-api.log 2>&1 &
API_PID=$!

for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

BASE="http://127.0.0.1:$API_PORT"
# 40 КБ «аудио» — достаточно, чтобы пройти проверку минимального размера.
head -c 40000 /dev/urandom >/tmp/speacher-smoke.webm

printf "\n[1] health\n"
check "health ok" '"ok":true' "$(curl -s "$BASE/api/health")"

printf "\n[2] транскрипция"
TRANSCRIBE="$(curl -s -X POST "$BASE/api/transcribe?language=ru&model=turbo&durationMs=6400&ext=webm" \
  -H 'content-type: audio/webm' --data-binary @/tmp/speacher-smoke.webm)"
check "вернулся текст" '"text"' "$TRANSCRIBE"
check "определён язык" '"detectedLanguage":"ru"' "$TRANSCRIBE"
check "есть confidence" '"noSpeechProbability"' "$TRANSCRIBE"

printf "\n[3] пустое аудио"
check "отклонено" '"error":"empty_audio"' "$(curl -s -X POST "$BASE/api/transcribe?durationMs=5000" \
  -H 'content-type: audio/webm' --data-binary 'x')"

printf "\n[4] слишком короткая запись"
check "отклонено" '"error":"too_short"' "$(curl -s -X POST "$BASE/api/transcribe?durationMs=200" \
  -H 'content-type: audio/webm' --data-binary @/tmp/speacher-smoke.webm)"

printf "\n[5] чистка текста"
FORMAT="$(curl -s -X POST "$BASE/api/format" -H 'content-type: application/json' \
  -d '{"text":"э-э, ну, давай встретимся во вторник, то есть в четверг, как бы, в общем, в шесть","style":"message","language":"ru"}')"
check "филлеры убраны" '"text":"Давай' "$FORMAT"
check "самокоррекция" 'в четверг' "$FORMAT"
check "без fallback" '"fallback":false' "$FORMAT"

printf "\n[6] пустой текст"
check "отклонено" '"error":"empty_text"' "$(curl -s -X POST "$BASE/api/format" \
  -H 'content-type: application/json' -d '{"text":"  "}')"

printf "\n[7] лимит Groq 429"
curl -s -X POST "http://127.0.0.1:$MOCK_PORT/__mock/fail" -H 'content-type: application/json' \
  -d '{"transcribe429":1}' >/dev/null
RESP="$(curl -s -i -X POST "$BASE/api/transcribe?durationMs=6400" -H 'content-type: audio/webm' \
  --data-binary @/tmp/speacher-smoke.webm)"
check "статус 429" 'HTTP/1.1 429' "$RESP"
check "код ошибки" '"error":"rate_limit"' "$RESP"
check "есть retryAfter" '"retryAfter":3' "$RESP"

printf "\n[8] падение LLM — отдаём сырой текст"
curl -s -X POST "http://127.0.0.1:$MOCK_PORT/__mock/fail" -H 'content-type: application/json' \
  -d '{"format500":1}' >/dev/null
check "fallback" '"fallback":true' "$(curl -s -X POST "$BASE/api/format" \
  -H 'content-type: application/json' -d '{"text":"э-э, ну тестовый текст","style":"neutral"}')"

printf "\n[9] запрос без ключа"
kill "$API_PID" 2>/dev/null; wait "$API_PID" 2>/dev/null
API_PORT="$((API_PORT + 1))" npx tsx server/index.ts >/tmp/speacher-api2.log 2>&1 &
API_PID=$!
for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:$((API_PORT + 1))/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
check "503 без ключа" '"error":"no_key"' "$(curl -s -X POST \
  "http://127.0.0.1:$((API_PORT + 1))/api/transcribe" -H 'content-type: audio/webm' \
  --data-binary @/tmp/speacher-smoke.webm)"

printf "\n──────────────────────────────\n"
printf "пройдено: %s, провалено: %s\n" "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
