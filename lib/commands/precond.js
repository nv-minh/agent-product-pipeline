// Tiền điều kiện dùng chung cho các lệnh nhận `<feature> <stage>`.
//
// `unknownStageId` từng bị COPY nguyên văn ba chỗ — gate.js (inline), review.js
// và human.js — tức đã quá rule-of-three của Điều 1: một thông điệp lỗi được ba
// lệnh hứa in giống nhau thì phải có một nguồn duy nhất, nếu không nó sẽ trôi
// khỏi nhau ở lần sửa thứ tư.
//
// `upstreamBlocked` (B5) là tiền điều kiện MỚI, và nó cần đúng ba lệnh đó — nên
// file này ra đời ở đây thay vì copy lần thứ tư.
import { stageOrder } from '../config.js'
import { upstreamGap } from '../gate.js'

// C2 — TÊN FEATURE LÀ MỘT MẢNH ĐƯỜNG DẪN, VÀ NÓ TỪNG KHÔNG BỊ KIỂM Ở BẤT KỲ
// LỆNH NÀO. Tái lập được: `pp init ../../evil --root /a/b` scaffold nguyên một
// feature ra /a/evil — NGOÀI repo, exit 0. Tệ gấp đôi: đường dẫn đã traverse
// không còn chứa đoạn "features/" nguyên vẹn, nên mọi guard đang canh pattern
// đường dẫn features/ (PreToolUse) cũng mất dấu nó luôn — vừa thoát thư mục,
// vừa thoát người canh. Allowlist, không phải blocklist: chữ thường, số, gạch
// nối, bắt đầu bằng chữ/số — đúng hình dạng mọi feature đã có (demo,
// archive-command, thanh-toan).
export const FEATURE_NAME = /^[a-z0-9][a-z0-9-]*$/

export function badFeatureName(feature) {
  if (FEATURE_NAME.test(feature)) return false
  process.stderr.write(
    `pp: tên feature "${feature}" không hợp lệ — chỉ chữ thường a-z, số và gạch nối, ` +
    `bắt đầu bằng chữ hoặc số (${FEATURE_NAME}).\n` +
    'Tên chứa "/", ".." hay khoảng trắng sẽ trỏ ra NGOÀI features/ (path traversal) ' +
    'và đồng thời thoát khỏi mọi guard đang canh đường dẫn features/.\n',
  )
  return true
}

export function unknownStageId(feature, stageId, config) {
  process.stderr.write(
    `pp: stage "${stageId}" không tồn tại trong pipeline.json của feature "${feature}"\n` +
    `Các stage có sẵn: ${stageOrder(config).join(', ')}\n`,
  )
  return 2
}

// B5 — trả `true` (và đã in lý do) nếu chưa tới lượt stage này.
//
// exit 1, không phải 2: đối số hoàn toàn hợp lệ, chỉ là thao tác bị từ chối ở
// thời điểm này — cùng hạng với `t1NotPassed` (T2 không được chạy trước T1), lỗi
// cùng loại nên phải có cùng exit code.
export function upstreamBlocked(featureDir, config, state, feature, stageId) {
  const gap = upstreamGap(featureDir, config, state, stageId)
  if (!gap) return false
  process.stderr.write(
    `pp: chưa tới lượt ${stageId} — stage thượng nguồn ${gap.stage} ${gap.why}.\n` +
    'Thứ tự stage là luật thi hành, không phải gợi ý: một test plan không được ' +
    'done trước cái PRD nó truy vết tới.\n' +
    `Làm xong ${gap.stage} trước — \`pp status ${feature}\` cho biết bước kế tiếp.\n`,
  )
  return true
}
