// tests/status-line.test.js
//
// R2 (review cuối) — TÍN HIỆU HOÀN THÀNH PHẢI TỚI ĐƯỢC NGƯỜI ĐỌC NÓ.
// `commands/pp.md` bước 4 nói với agent đang lái pipeline: stage chỉ xong khi
// `pp gate` / `pp review-record` in `✓ <stage>: done`. `gate` in dòng đó;
// `review-record` trước bản vá chỉ in evidence log rồi exit 0 — nên trên MỌI
// stage khai báo `t2` (tức mọi stage mặc định) tín hiệu ấy KHÔNG BAO GIỜ xuất
// hiện, và agent bị đẩy vào chỗ tự kết luận. Không test nào từng khẳng định
// chuỗi này; file này khoá nó lại cho CẢ HAI lệnh, ở CẢ HAI dạng.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run, passT1Prd, verdictFile } from './helpers.js'

const done = (tiers) => `✓ 10-prd: done — mọi tier bắt buộc (${tiers}) đã xanh`
const notDone = (tiers) => `⏳ 10-prd: CHƯA done — còn thiếu tier: ${tiers}`

function initRoot() {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  return r0
}

function onlyT1(r0) {
  const pj = join(r0, 'features/demo/pipeline.json')
  const cfg = JSON.parse(readFileSync(pj, 'utf8'))
  cfg.stages['10-prd'].gate = ['t1']
  writeFileSync(pj, JSON.stringify(cfg, null, 2))
}

test('R2: pp gate in ĐÚNG NGUYÊN VĂN dòng done chuẩn', () => {
  const r0 = initRoot()
  onlyT1(r0)
  const r = passT1Prd(r0)
  assert.ok(r.out.includes(done('t1')), `thiếu dòng chuẩn trong:\n${r.out}`)
})

test('R2: pp gate in ĐÚNG NGUYÊN VĂN dòng CHƯA done chuẩn', () => {
  const r0 = initRoot()
  const r = passT1Prd(r0)
  assert.ok(r.out.includes(notDone('t2')), `thiếu dòng chuẩn trong:\n${r.out}`)
  assert.ok(!r.out.includes('✓ 10-prd: done'))
})

// Đây là dòng mà bước 4 của commands/pp.md bảo agent chờ — trước bản vá, trên
// stage có t2 nó không tồn tại ở bất kỳ đâu trong output của lệnh nào.
test('R2: pp review-record KẾT THÚC bằng đúng dòng done chuẩn đó', () => {
  const r0 = initRoot()
  passT1Prd(r0)
  const v = verdictFile(r0, 'demo', '10-prd', [])
  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0])
  assert.equal(r.code, 0)
  assert.ok(r.out.includes(done('t1, t2')), `thiếu dòng chuẩn trong:\n${r.out}`)
  assert.ok(r.out.trimEnd().endsWith(done('t1, t2')), 'dòng chuẩn phải là thứ CUỐI CÙNG lệnh in ra')
})

test('R2: pp review-record in đúng dòng CHƯA done chuẩn khi verdict có finding high', () => {
  const r0 = initRoot()
  passT1Prd(r0)
  const v = verdictFile(r0, 'demo', '10-prd', [
    { criterion: 'AC đo được', verdict: 'fail', severity: 'high', evidence: 'AC-1-1 mơ hồ', fix: 'viết lại' },
  ])
  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0])
  assert.equal(r.code, 1)
  assert.ok(r.out.includes(notDone('t2')), `thiếu dòng chuẩn trong:\n${r.out}`)
})

// Hai lệnh phải dùng CHUNG một hàm: cùng một trạng thái stage thì cùng một chữ.
test('R2: gate và review-record in y hệt nhau cho cùng một trạng thái stage', () => {
  const r0 = initRoot()
  passT1Prd(r0)
  const v = verdictFile(r0, 'demo', '10-prd', [])
  const rr = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0])
  const gg = run(['gate', 'demo', '10-prd', '--root', r0]) // re-gate: stage vẫn done
  const line = (out) => out.split('\n').find((l) => l.startsWith('✓ 10-prd:'))
  assert.equal(line(gg.out), line(rr.out))
  assert.equal(line(gg.out), done('t1, t2'))
})
