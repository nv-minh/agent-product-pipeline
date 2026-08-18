#!/usr/bin/env bash
# hooks/stop.sh — chặn kết thúc lượt khi còn stage chưa xanh.
#
# FIX review cuối (finding 5): bản trước gate trên $PP_FEATURE, mà KHÔNG CHỖ
# NÀO set biến đó — nên hook exit 0 vô điều kiện trong mọi phiên và tầng chặn
# thứ hai của §5.3 chưa từng chạy. Bỏ hẳn phụ thuộc: `pp guard-stop` không
# tham số tự dò gốc repo từ cwd rồi soát MỌI feature. Không tìm thấy gốc repo
# (phiên không liên quan) thì nó exit 0 — hook không bao giờ chặn oan.
#
# Chặn = exit 2 + lý do ra stderr (hợp đồng hook của Claude Code); mọi exit
# khác 0 chỉ là lỗi không chặn.
exec node "$(dirname "$0")/../bin/pp" guard-stop
