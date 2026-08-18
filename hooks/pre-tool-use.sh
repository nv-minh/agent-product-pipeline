#!/usr/bin/env bash
# hooks/pre-tool-use.sh — chặn agent ghi STATE.md và .evidence/
#
# FIX review Task 12 (finding 2 CRITICAL + finding 4 Important): bản trước
# tự parse JSON ở đây bằng grep/sed dưới `set -euo pipefail`. Khi `grep -o`
# không khớp gì (payload không có file_path, stdin rỗng, JSON méo), pipeline
# trả 1 và `set -e` abort script ngay tại dòng gán biến — dòng kiểm tra
# rỗng phía sau không bao giờ chạy, nên script thoát != 0 và Claude Code
# CHẶN NHẦM mọi Write/Edit thấy được, không có chẩn đoán gì (fail CLOSED
# thay vì fail OPEN). grep cũng không phải JSON parser thật: file_path xuất
# hiện hai lần thì lấy nhầm giá trị đầu, giá trị có dấu " escape thì bị cắt
# cụt.
#
# Sửa: không parse JSON ở shell nữa. Chuyển thẳng toàn bộ stdin cho
# `pp guard-write --stdin`, nơi JSON.parse thật xử lý và LUÔN fail-open khi
# payload không hợp lệ. Không jq, không grep/sed, không set -e foot-gun.
exec node "$(dirname "$0")/../bin/pp" guard-write --stdin
