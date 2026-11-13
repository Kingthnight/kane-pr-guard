#!/usr/bin/env bash
# Run every Kane CLI *_test.md flow in this directory against $BASE_URL
# and write a combined machine-readable report to results/combined.json
#
# Usage:
#   BASE_URL=http://localhost:3000 ./run-all.sh
#   BASE_URL=http://127.0.0.1:3000 ./run-all.sh login_test.md checkout_test.md
#
# Exit codes (script):
#   0  every flow passed
#   1  at least one flow ran and failed (Kane exit 1)
#   2  at least one flow had a CLI/setup error (Kane exit 2), unless a 3 is also present
#   3  at least one flow timed out or was cancelled (Kane exit 3)
#   If both failures and errors exist, the highest Kane-style code wins (3 > 2 > 1).
set -uo pipefail
export PATH="$(npm prefix -g)/bin:${PATH}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BASE_URL="${BASE_URL:-http://localhost:3000}"
RESULTS_DIR="${RESULTS_DIR:-$ROOT/results}"
TIMEOUT_SECS="${TIMEOUT_SECS:-180}"
MAX_STEPS="${MAX_STEPS:-50}"
mkdir -p "$RESULTS_DIR"

if ! command -v kane-cli >/dev/null 2>&1; then
  echo "kane-cli not found on PATH. Run: export PATH=\"\$(npm prefix -g)/bin:\$PATH\"" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to build combined.json" >&2
  exit 2
fi

# Select flows: remaining args, or every *_test.md in this folder (not subdirs).
if [[ $# -gt 0 ]]; then
  FLOWS=("$@")
else
  shopt -s nullglob
  FLOWS=(*_test.md)
  shopt -u nullglob
fi
if [[ ${#FLOWS[@]} -eq 0 ]]; then
  echo "No *_test.md flows to run" >&2
  exit 2
fi

credits_now() {
  # kane-cli balance prints "Available credits: N" (and sometimes a skill notice).
  kane-cli balance 2>/dev/null | awk '/Available credits:/{print $3; exit}'
}

STARTED_IST="$(TZ=Asia/Calcutta date '+%Y-%m-%d %H:%M:%S IST')"
STARTED_ISO="$(TZ=Asia/Calcutta date -Iseconds)"
CREDITS_BEFORE="$(credits_now || true)"

OVERALL_EXIT=0
bump_exit() {
  local c="$1"
  # Prefer timeout/cancel (3), then infra error (2), then test failure (1).
  if [[ "$c" -eq 3 ]]; then
    OVERALL_EXIT=3
  elif [[ "$c" -eq 2 && "$OVERALL_EXIT" -ne 3 ]]; then
    OVERALL_EXIT=2
  elif [[ "$c" -ne 0 && "$OVERALL_EXIT" -eq 0 ]]; then
    OVERALL_EXIT=1
  fi
}

FLOW_JSON_PARTS=()

for flow in "${FLOWS[@]}"; do
  if [[ ! -f "$flow" ]]; then
    echo "Missing flow file: $flow" >&2
    bump_exit 2
    FLOW_JSON_PARTS+=("$(jq -n --arg flow "$flow" '{flow:$flow,exit_code:2,status:"error",error:"file not found"}')")
    continue
  fi

  stem="${flow%_test.md}"
  stem="${stem##*/}"
  out_dir="$RESULTS_DIR/$stem"
  mkdir -p "$out_dir"
  ndjson="$out_dir/events.ndjson"
  stderrf="$out_dir/stderr.log"

  echo "=== Running $flow against $BASE_URL ===" >&2
  set +e
  kane-cli testmd run "$flow" \
    --agent \
    --headless \
    --url "$BASE_URL" \
    --override-start-url "$BASE_URL" \
    --on-lock-conflict wait \
    --max-steps "$MAX_STEPS" \
    --timeout "$TIMEOUT_SECS" \
    >"$ndjson" 2>"$stderrf"
  code=$?
  set -e
  echo "=== $flow exit $code ===" >&2
  bump_exit "$code"

  # evidence pack path is printed on stderr, not in NDJSON.
  evidence="$(awk -F'`' '/kane-cli evidence serve /{
    for (i=1;i<=NF;i++) if ($i ~ /\\.evidence$/) print $i
  }' "$stderrf" | tail -n 1)"

  # Parse the file-level completion event. Individual steps also emit run_end;
  # those are not the file result. Fall back to the last run_end if needed.
  FLOW_JSON_PARTS+=("$(
    jq -n \
      --arg flow "$flow" \
      --argjson exit_code "$code" \
      --arg evidence "${evidence:-}" \
      --rawfile ndjson "$ndjson" \
      --rawfile stderr "$stderrf" '
      ($ndjson | split("\n") | map(select(length>0) | try fromjson catch empty)) as $ev
      | ($ev | map(select(.type=="test_md_done")) | last) as $done
      | ($ev | map(select(.type=="run_end")) | last) as $end
      | ($ev | map(select(.status=="failed" and .remark != null) | .remark) | last) as $fail_remark
      | {
          flow: $flow,
          exit_code: $exit_code,
          status: (
            if $done != null then ($done.overall_status // $done.status)
            elif $end != null then $end.status
            elif $exit_code == 0 then "passed"
            elif $exit_code == 1 then "failed"
            elif $exit_code == 3 then "timeout"
            else "error" end
          ),
          duration_s: ($done.duration_s // $end.duration),
          credits_consumed: ($done.credits_consumed // $end.credits_consumed),
          session_id: ($done.session_id // null),
          session_dir: ($end.session_dir // $done.session_dir // null),
          test_url: ($end.test_url // $done.test_url // null),
          share_url: ($done.share_url // $end.test_url // null),
          evidence_pack: (if $evidence == "" then null else $evidence end),
          result_code: ($end.result_code // $done.result_code // null),
          reason: ($end.reason // $done.reason // null),
          summary: ($done.summary // $end.summary // $end.one_liner // null),
          failed_remark: $fail_remark,
          ndjson: $ndjson | rtrimstr("\n") | if . == "" then null else . end | (if . == null then null else "\(env.RESULTS_DIR // "")" end)
        }
        | .ndjson = null
        | .artifacts = {
            ndjson: "results/\($flow | sub("_test\\.md$"; "") )/events.ndjson",
            stderr: "results/\($flow | sub("_test\\.md$"; "") )/stderr.log"
          }
    '
  )")
done

FINISHED_IST="$(TZ=Asia/Calcutta date '+%Y-%m-%d %H:%M:%S IST')"
FINISHED_ISO="$(TZ=Asia/Calcutta date -Iseconds)"
CREDITS_AFTER="$(credits_now || true)"

# Stitch flow objects into combined.json
printf '%s\n' "${FLOW_JSON_PARTS[@]}" | jq -s \
  --arg base_url "$BASE_URL" \
  --arg started_ist "$STARTED_IST" \
  --arg started_iso "$STARTED_ISO" \
  --arg finished_ist "$FINISHED_IST" \
  --arg finished_iso "$FINISHED_ISO" \
  --arg credits_before "${CREDITS_BEFORE:-}" \
  --arg credits_after "${CREDITS_AFTER:-}" \
  --argjson overall_exit "$OVERALL_EXIT" '
  def numor($s): if ($s|length)==0 then null else (try ($s|tonumber) catch $s) end;
  {
    base_url: $base_url,
    started: $started_ist,
    started_iso: $started_iso,
    finished: $finished_ist,
    finished_iso: $finished_iso,
    credits_before: numor($credits_before),
    credits_after: numor($credits_after),
    credits_spent: (
      if (numor($credits_before)|type)=="number" and (numor($credits_after)|type)=="number"
      then (numor($credits_before) - numor($credits_after))
      else null end
    ),
    overall_passed: ($overall_exit==0),
    exit_code: $overall_exit,
    flows: .
  }
' > "$RESULTS_DIR/combined.json"

echo "Wrote $RESULTS_DIR/combined.json (overall exit $OVERALL_EXIT)" >&2
jq '{base_url,started,finished,credits_before,credits_after,credits_spent,overall_passed,exit_code,flows:[.flows[]|{flow,exit_code,status,test_url,share_url,evidence_pack,credits_consumed}]}' "$RESULTS_DIR/combined.json" >&2
exit "$OVERALL_EXIT"
