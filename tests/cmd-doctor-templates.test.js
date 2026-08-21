// Task 8 (pp-bugfix/pp-change): template thiếu/hỏng làm pp init chết ngay cửa —
// doctor phải nhìn thấy trước (spec §8). Doctor đọc template theo PKG_ROOT
// (bản cài pp), nên test này kiểm trên repo thật — cả 4 template phải lành.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeRoot, run } from './helpers.js'

test('doctor liệt kê đủ 4 template pipeline và đều JSON hợp lệ', () => {
  const r = run(['doctor', '--root', makeRoot()])
  for (const t of ['pipeline.S.json', 'pipeline.M.json', 'pipeline.bugfix.json', 'pipeline.change.json']) {
    assert.match(r.out, new RegExp(`templates/${t.replace('.', '\\.')}.*JSON hợp lệ`))
  }
})
