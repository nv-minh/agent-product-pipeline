// tests/cmd-review-archive.test.js — pp review-record lưu vĩnh viễn MỖI
// verdict vào .review/<stage>.<seq>.json: nguyên văn + hash, đánh số đơn điệu
// TÁCH KHỎI attempts (attempts reset về 0 khi stage done — dùng lại số đó sẽ
// ghi đè lịch sử sau chu kỳ re-gate).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { run, makeRoot, passT1Prd, verdictFile } from './helpers.js'
import { readAudit } from '../lib/audit.js'

const sha12 = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12)

const HIGH = { criterion: 'AC đo được', verdict: 'fail', severity: 'high', evidence: 'AC mơ hồ', fix: 'viết EARS' }
const PASS = { criterion: 'Out of scope', verdict: 'pass', severity: 'low', evidence: '', fix: '' }

function setup(feature = 'demo') {
  const root = makeRoot()
  run(['init', feature, '--size', 'S', '--root', root])
  passT1Prd(root, feature)
  return root
}

function loadArchive(root, seq, stage = '10-prd', feature = 'demo') {
  return JSON.parse(readFileSync(join(root, 'features', feature, '.review', `${stage}.${seq}.json`), 'utf8'))
}

function seqs(root, stage = '10-prd', feature = 'demo') {
  const d = join(root, 'features', feature, '.review')
  return readdirSync(d).filter((f) => f.startsWith(`${stage}.`) && f.endsWith('.json'))
    .map((f) => Number(f.slice(stage.length + 1, -'.json'.length))).sort((a, b) => a - b)
}

test('lần review đầu: .review/10-prd.1.json — verdict nguyên văn + verdict_sha + prompt_sha', () => {
  const root = setup()
  const vf = verdictFile(root, 'demo', '10-prd', [HIGH, PASS])
  const raw = readFileSync(vf, 'utf8')
  const r = run(['review-record', 'demo', '10-prd', '--verdict', vf, '--root', root])
  assert.equal(r.code, 1) // finding high → đỏ, nhưng VẪN archive
  const a = loadArchive(root, 1)
  assert.equal(a.v, 1)
  assert.equal(a.feature, 'demo')
  assert.equal(a.stage, '10-prd')
  assert.equal(a.seq, 1)
  assert.equal(a.attempt, 1)
  // Nguyên văn, không biên tập — kể cả field `nonce` mà A3 thêm vào verdict.
  assert.deepEqual(a.verdict.findings, [HIGH, PASS])
  assert.match(a.verdict.nonce, /^[0-9a-f]{18}$/)
  // Nonce của phiếu đã dùng cũng được lưu ở tầng archive để truy lại sau.
  assert.equal(a.nonce, a.verdict.nonce)
  assert.match(a.prompt_issued_at, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(a.verdict_sha, sha12(raw))
  assert.equal(a.verdict_path, '.review-10-prd.json')
  assert.equal(a.findings_total, 2)
  assert.equal(a.findings_high, 1)
  assert.equal(a.ok, false)
  assert.match(a.prompt_sha, /^[0-9a-f]{12}$/)
  assert.match(a.ts, /^\d{4}-\d{2}-\d{2}T/)
})

test('review đỏ lần hai: .2.json với attempt 2; audit event review mang archive + verdict_sha', () => {
  const root = setup()
  const vf1 = verdictFile(root, 'demo', '10-prd', [HIGH])
  run(['review-record', 'demo', '10-prd', '--verdict', vf1, '--root', root])
  const vf2 = verdictFile(root, 'demo', '10-prd', [HIGH])
  const raw2 = readFileSync(vf2, 'utf8')
  run(['review-record', 'demo', '10-prd', '--verdict', vf2, '--root', root])

  assert.deepEqual(seqs(root), [1, 2])
  assert.equal(loadArchive(root, 2).attempt, 2)
  const reviews = readAudit(join(root, 'features/demo')).filter((e) => e.event === 'review')
  assert.equal(reviews.length, 2)
  assert.equal(reviews[1].details.archive, '.review/10-prd.2.json')
  assert.equal(reviews[1].details.verdict_sha, sha12(raw2))
})

test('done → re-gate → review lại: seq TĂNG TIẾP dù attempts đã reset — không ghi đè lịch sử', () => {
  const root = setup()
  // 1) review đỏ
  const vf1 = verdictFile(root, 'demo', '10-prd', [HIGH])
  run(['review-record', 'demo', '10-prd', '--verdict', vf1, '--root', root])
  // 2) review xanh → stage done (attempts reset về 0)
  const vf2 = verdictFile(root, 'demo', '10-prd', [])
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', vf2, '--root', root]).code, 0)
  // 3) chu kỳ re-gate: gate xanh lại rồi review lại
  run(['gate', 'demo', '10-prd', '--root', root])
  const vf3 = verdictFile(root, 'demo', '10-prd', [PASS])
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', vf3, '--root', root]).code, 0)

  assert.deepEqual(seqs(root), [1, 2, 3], 'ba lần review = ba bản lưu, không ai ghi đè ai')
  // attempts đã reset về 0 sau done → attempt của bản 3 là 1, nhưng seq là 3
  assert.equal(loadArchive(root, 3).seq, 3)
  assert.equal(loadArchive(root, 3).attempt, 1)
})

// ĐỔI HÀNH VI CÓ CHỦ ĐÍCH (A3). Test này trước đây khoá hành vi: thiếu rubric lúc
// record thì vẫn ghi archive với `prompt_sha: null` và exit 0. Đó chính là điểm
// yếu: `prompt_sha` được TÍNH nhưng không chỗ nào so, nên một verdict không thể
// tái dựng được prompt vẫn đưa stage tới done. Nay `review-record` đòi prompt dựng
// lại phải khớp prompt đã phát, nên hai trường hợp dưới đây đều bị từ chối — rõ
// ràng, không crash, và state không đổi.
test('thiếu rubric TRƯỚC KHI phát phiếu: không có phiếu nào mở → review-record từ chối', () => {
  const root = setup()
  rmSync(join(root, 'rubric', '10-prd.md'))
  const vf = verdictFile(root, 'demo', '10-prd', []) // review-prompt bên trong sẽ exit 2
  const r = run(['review-record', 'demo', '10-prd', '--verdict', vf, '--root', root])
  assert.equal(r.code, 1)
  assert.match(r.out, /chưa có phiếu review đang mở/)
  assert.equal(existsSync(join(root, 'features/demo/.review/10-prd.1.json')), false, 'không archive verdict không hợp lệ')
})

test('rubric bị xoá SAU khi phát phiếu: prompt không dựng lại được → từ chối vì drift', () => {
  const root = setup()
  const vf = verdictFile(root, 'demo', '10-prd', []) // phiếu được phát khi rubric còn
  rmSync(join(root, 'rubric', '10-prd.md'))
  const r = run(['review-record', 'demo', '10-prd', '--verdict', vf, '--root', root])
  assert.equal(r.code, 1)
  assert.match(r.out, /đã đổi sau khi phát prompt/)
  assert.equal(existsSync(join(root, 'features/demo/.review/10-prd.1.json')), false)
})

test('review-prompt output không đổi sau refactor: đủ 3 đoạn CONSTITUTION/RUBRIC/ARTIFACT', () => {
  const root = setup()
  const r = run(['review-prompt', 'demo', '10-prd', '--root', root])
  assert.equal(r.code, 0)
  assert.match(r.out, /=== CONSTITUTION ===/)
  assert.match(r.out, /=== RUBRIC \(10-prd\) ===/)
  assert.match(r.out, /=== ARTIFACT \(10-prd\.md\) ===/)
})
