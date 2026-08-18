#!/usr/bin/env bash
# hooks/stop.sh — chặn kết thúc lượt khi còn stage chưa xanh
# PP_FEATURE do /pp đặt; không có thì không chặn gì.
set -euo pipefail
[ -z "${PP_FEATURE:-}" ] && exit 0
exec node "$(dirname "$0")/../bin/pp" guard-stop "$PP_FEATURE"
