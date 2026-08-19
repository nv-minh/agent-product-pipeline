// lib/audit.js — sổ kiểm toán append-only của MỘT feature: features/<f>/audit.jsonl
// Mỗi lệnh pp làm thay đổi state/review của feature để lại đúng MỘT dòng JSON
// mỗi lần chạy. Khác lessons/ (sổ tay của NGƯỜI về quyết định, chỉ có ngày),
// audit là sổ của CẢ HỆ THỐNG: ts ISO đầy đủ đến giây, actor, event, kết quả.
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function auditPath() {
  return 'audit.jsonl'
}

// BEST-EFFORT — và điều đó là luật, không phải sự cho phép: exit code của
// lệnh gọi (gate đỏ/xanh, review đỏ/xanh) là DỮ KIỆN về phía pipeline; lỗi
// ghi audit không được phép làm sai dữ kiện đó. Lỗi thì ồn ào đúng một dòng
// ở stderr rồi bỏ qua — im lặng nuốt lỗi cũng không được.
export function auditEvent(featureDir, fields) {
  // Thứ tự key cố định để dòng audit là tất định (diff/git ổn định giữa các
  // lần chạy, không phụ thuộc thứ tự key của object truyền vào).
  const e = {
    ts: new Date().toISOString(),
    v: 1,
    actor: fields.actor,
    event: fields.event,
    feature: fields.feature,
  }
  if (fields.stage !== undefined) e.stage = fields.stage
  if (fields.ok !== undefined) e.ok = fields.ok
  if (fields.reason !== undefined) e.reason = fields.reason
  if (fields.details !== undefined) e.details = fields.details
  try {
    // Một appendFileSync MỘT dòng: cùng mức rủi ro chạy-đồng-thời với
    // lessons/ hôm nay — chấp nhận, ghi rõ ở đây để người sau biết ranh giới.
    appendFileSync(join(featureDir, auditPath()), JSON.stringify(e) + '\n')
  } catch (err) {
    process.stderr.write(`pp: không ghi được ${auditPath()} (${err.message}) — bỏ qua, không đổi kết quả lệnh\n`)
  }
}

// Đọc lại sổ: bỏ dòng rỗng/dỏm thay vì crash — một dòng hỏng (sửa tay, cắt
// cụt) không được làm mất khả năng đọc phần còn lại của bằng chứng.
// Feature tạo TRƯỚC thay đổi này chưa có audit.jsonl: trả [] (thưa thớt, không lỗi).
export function readAudit(featureDir) {
  let text
  try {
    text = readFileSync(join(featureDir, auditPath()), 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // dòng hỏng: bỏ qua
    }
  }
  return out
}
