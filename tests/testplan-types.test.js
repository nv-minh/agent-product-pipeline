// B1 — GATE TỪNG ĐÁNH ĐỎ CHÍNH THỨ SPEC BẮT BUỘC.
//
// Spec §5.1: "mỗi AC có ≥1 `positive` và ≥1 `negative`; mỗi field số/chuỗi/ngày
// có ≥1 `boundary`; mỗi endpoint có phân quyền có ≥1 `permission`". Code chỉ
// biết hai loại và báo `type "boundary" không hợp lệ` — nên một testplan viết
// ĐÚNG SPEC không thể qua gate. Quan sát được trong lần chạy thật đầu tiên trên
// feature `archive-command`.
//
// Sau bản vá: bốn loại đều hợp lệ, nhưng chỉ positive+negative bị ép mỗi AC.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkTcSchema, checkTypeRatio } from '../lib/checks/testplan.js'

const PRD_1AC = '<us id="US-1">story</us>\n<ac id="AC-1-1" story="US-1">WHEN x THE SYSTEM SHALL y</ac>'

function tc(id, type, ac = 'AC-1-1') {
  return `<tc id="${id}" ac_ref="${ac}" type="${type}" priority="high">
precondition: p
steps: s
expected: e
</tc>`
}

test('type "boundary" và "permission" là HỢP LỆ (spec §5.1)', () => {
  const r = checkTcSchema([tc('TC-1', 'boundary'), tc('TC-2', 'permission')].join('\n\n'))
  assert.equal(r.ok, true, `phải hợp lệ, nhận: ${r.messages.join(' | ')}`)
  assert.deepEqual(r.messages, [])
})

test('cả bốn loại spec khai đều hợp lệ, và nhận không phân biệt hoa thường', () => {
  const r = checkTcSchema([
    tc('TC-1', 'positive'), tc('TC-2', 'Negative'),
    tc('TC-3', 'BOUNDARY'), tc('TC-4', ' permission '),
  ].join('\n\n'))
  assert.equal(r.ok, true, `phải hợp lệ, nhận: ${r.messages.join(' | ')}`)
})

// Nới lỏng không được thành "nhận mọi thứ": một type viết sai/bịa vẫn phải đỏ,
// vì đó là lý do check này tồn tại (FINDING 4 cũ — type lạ làm AC trông như
// chưa được phủ mà không nói vì sao).
test('type bịa vẫn ĐỎ, và thông báo liệt kê đủ bốn loại được phép', () => {
  const r = checkTcSchema(tc('TC-1', 'smoke'))
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /TC-1: type "smoke" không hợp lệ/)
  for (const t of ['positive', 'negative', 'boundary', 'permission']) {
    assert.match(r.messages.join('\n'), new RegExp(t), `thông báo phải nêu "${t}"`)
  }
})

// ĐÂY LÀ CÁI BẪY CỦA BẢN VÁ NÀY: nếu thêm boundary/permission vào danh sách
// "bắt buộc mỗi AC" thì mọi AC sẽ bị đòi đủ bốn loại (sai spec, và đỏ oan hàng
// loạt). Nếu ngược lại để chúng THAY THẾ được positive/negative thì mất chính
// gate đáng giá nhất. Hai test dưới khoá cả hai phía.
test('mỗi AC vẫn BẮT BUỘC có positive và negative', () => {
  const r = checkTypeRatio(PRD_1AC, tc('TC-1', 'positive'))
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /AC-1-1: thiếu case "negative"/)
})

test('boundary/permission KHÔNG thay thế được positive/negative', () => {
  const r = checkTypeRatio(PRD_1AC, [tc('TC-1', 'boundary'), tc('TC-2', 'permission')].join('\n\n'))
  assert.equal(r.ok, false, 'chỉ có boundary+permission thì AC vẫn chưa được phủ')
  const msg = r.messages.join('\n')
  assert.match(msg, /AC-1-1: thiếu case "positive"/)
  assert.match(msg, /AC-1-1: thiếu case "negative"/)
})

test('boundary/permission KHÔNG bị ép — có đủ positive+negative là xanh', () => {
  const r = checkTypeRatio(PRD_1AC, [tc('TC-1', 'positive'), tc('TC-2', 'negative')].join('\n\n'))
  assert.equal(r.ok, true, `không được đòi boundary/permission, nhận: ${r.messages.join(' | ')}`)
})

test('AC có đủ bốn loại thì xanh, không báo thừa', () => {
  const r = checkTypeRatio(PRD_1AC, [
    tc('TC-1', 'positive'), tc('TC-2', 'negative'),
    tc('TC-3', 'boundary'), tc('TC-4', 'permission'),
  ].join('\n\n'))
  assert.equal(r.ok, true, `nhận: ${r.messages.join(' | ')}`)
})
