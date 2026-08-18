#!/usr/bin/env bash
# hooks/pre-tool-use.sh — chặn agent ghi STATE.md và .evidence/
# stdin: JSON của Claude Code hook. Lấy đường dẫn file bằng grep, không cần jq.
set -euo pipefail
PAYLOAD="$(cat)"
FILE_PATH="$(printf '%s' "$PAYLOAD" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
[ -z "${FILE_PATH:-}" ] && exit 0
exec node "$(dirname "$0")/../bin/pp" guard-write --path "$FILE_PATH"
