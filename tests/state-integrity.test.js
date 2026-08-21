// C1 + C6 — STATE.md LÀ SỔ CÁI, VÀ SỔ CÁI TỪNG CÓ BA ĐIỂM CHẾT:
//
// C1a  `writeState` ghi thẳng `writeFileSync` — process bị giết giữa lúc ghi
//      để lại một file cụt, và MỌI lệnh cần state chết theo. Nay ghi ra file
//      tạm cùng thư mục rồi `renameSync` đè (atomic trong cùng filesystem).
// C1b  `recordTierRun`/`mergeFreshStage` là read-modify-write KHÔNG khoá —
//      hai lệnh pp song song trên cùng feature ghi đè kết luận của nhau
//      (lost update). Nay cả cụm nằm trong khoá `mkdirSync` (.pp-lock).
// C6   Một STATE.md hỏng chết bằng lỗi parser thô. Tái lập được trước bản vá:
//      cắt file giữa khối JSON rồi chạy bất kỳ lệnh nào →
//        "pp: Expected double-quoted property name in JSON at position 23"
//      Không tên file, không lý do, không lối ra.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, mkdirSync, rmdirSync, unlinkSync, utimesSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { makeRoot, run, passT1Prd, PP } from './helpers.js'

function initDemo() {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  return { r0, dir: join(r0, 'features', 'demo') }
}

const stateFile = (dir) => join(dir, 'STATE.md')

// Cắt STATE.md tại một điểm cho trước TÍNH TỪ khối pp:state — đúng hình dạng
// một lần ghi bị giết nửa chừng (trước khi writeState thành atomic).
function truncateState(dir, offsetIntoBlock) {
  const txt = readFileSync(stateFile(dir), 'utf8')
  const i = txt.indexOf('<!-- pp:state')
  writeFileSync(stateFile(dir), txt.slice(0, i + offsetIntoBlock))
}

// Đọc khối JSON trong STATE.md (test được ĐỌC — luật vàng chỉ cấm ghi).
function readStateBlock(dir) {
  const txt = readFileSync(stateFile(dir), 'utf8')
  return JSON.parse(txt.split('<!-- pp:state')[1].split('-->')[0])
}

// ─── C6: hỏng phải nói tên file, lý do, và lối ra ─────────────────────────

test('C6: STATE.md cụt giữa khối JSON — lỗi nêu tên file và cả hai lối khôi phục', () => {
  const { r0, dir } = initDemo()
  truncateState(dir, 40)
  const r = run(['status', 'demo', '--root', r0])
  assert.equal(r.code, 1)
  // Trước bản vá: "pp: Expected double-quoted property name in JSON at
  // position 23" — người dùng bế tắc đúng lúc dữ liệu vừa hỏng.
  assert.match(r.out, /STATE\.md hỏng/)
  assert.match(r.out, new RegExp(stateFile(dir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(r.out, /git checkout/)
  assert.match(r.out, /xoá/)
})

test('C6: khối pp:state không có --> đóng — gọi đúng tên "file bị cắt cụt"', () => {
  const { r0, dir } = initDemo()
  // Cắt SÂU hơn điểm mở khối: còn "<!-- pp:state" nhưng mất "-->".
  truncateState(dir, 20)
  const r = run(['status', 'demo', '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /không có --> đóng/)
  assert.match(r.out, /cắt cụt/)
})

test('C6: mất hẳn khối pp:state — cùng chuẩn thông báo với hai đường hỏng kia', () => {
  const { r0, dir } = initDemo()
  writeFileSync(stateFile(dir), '# STATE bị thay bằng nội dung tay\n')
  const r = run(['status', 'demo', '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /thiếu khối <!-- pp:state/)
  assert.match(r.out, /git checkout/)
})

// Lối ra trong hướng dẫn phải là lối ra THẬT — xoá file hỏng thì pipeline
// đi lại được từ đầu, không cần đụng gì khác.
test('C6: xoá STATE.md hỏng thì pp hoạt động lại, gate chạy được từ trang trắng', () => {
  const { r0, dir } = initDemo()
  truncateState(dir, 40)
  assert.equal(run(['status', 'demo', '--root', r0]).code, 1)
  unlinkSync(stateFile(dir))
  passT1Prd(r0) // tự assert gate xanh
  assert.equal(readStateBlock(dir).stages['10-prd'].tiers.t1.result, 'pass')
})

// ─── C1a: ghi atomic ──────────────────────────────────────────────────────

test('C1: sau một lệnh ghi state, không còn file tạm .STATE.md.tmp-* nào sót lại', () => {
  const { r0, dir } = initDemo()
  passT1Prd(r0)
  const leftovers = readdirSync(dir).filter((f) => f.startsWith('.STATE.md.tmp-'))
  assert.deepEqual(leftovers, [])
})

test('C1: file tạm mồ côi của một process đã chết không ảnh hưởng lệnh sau', () => {
  const { r0, dir } = initDemo()
  // Mô phỏng: process trước bị giết SAU khi ghi tạm, TRƯỚC khi rename.
  writeFileSync(join(dir, '.STATE.md.tmp-99999'), '{ nội dung dở dang')
  passT1Prd(r0)
  // STATE.md thật vẫn parse được — file tạm dở dang không bao giờ mang tên STATE.md.
  assert.equal(readStateBlock(dir).stages['10-prd'].status, 'in_progress')
})

// ─── C1b: khoá ────────────────────────────────────────────────────────────

test('C1: khoá đang bị một lệnh khác giữ — từ chối rõ ràng, state không đổi', () => {
  const { r0, dir } = initDemo()
  const before = readFileSync(stateFile(dir), 'utf8')
  mkdirSync(join(dir, '.pp-lock'))
  const r = run(['override', 'demo', '10-prd', '--reason', 'x', '--root', r0],
    { env: { ...process.env, PP_LOCK_TIMEOUT_MS: '150' } })
  rmdirSync(join(dir, '.pp-lock'))
  assert.equal(r.code, 1)
  assert.match(r.out, /không giành được khoá/)
  assert.match(r.out, /\.pp-lock/)
  assert.equal(readFileSync(stateFile(dir), 'utf8'), before)
})

test('C1: khoá stale (process chết >30s trước) bị tự dọn — lệnh vẫn chạy, khoá được nhả', () => {
  const { r0, dir } = initDemo()
  const lock = join(dir, '.pp-lock')
  mkdirSync(lock)
  const old = new Date(Date.now() - 60_000)
  utimesSync(lock, old, old)
  const r = run(['override', 'demo', '10-prd', '--reason', 'x', '--root', r0],
    { env: { ...process.env, PP_LOCK_TIMEOUT_MS: '2000' } })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(readdirSync(dir).filter((f) => f === '.pp-lock'), [])
})

// Đua THẬT: hai process pp ghi state cùng lúc, lặp vài vòng. Trước khoá, đây
// là lost update xác suất (một trong hai override biến mất); sau khoá, CẢ HAI
// phải còn — mọi vòng, không có "thường là đủ".
test('C1: hai pp override song song trên hai stage — không mất cập nhật nào', async () => {
  const { r0, dir } = initDemo()
  const overrideAsync = (stage, reason) => new Promise((resolve) => {
    const p = spawn('node', [PP, 'override', 'demo', stage, '--reason', reason, '--root', r0])
    p.on('close', (code) => resolve(code))
  })
  for (let i = 1; i <= 5; i++) {
    const [a, b] = await Promise.all([
      overrideAsync('10-prd', `vòng ${i}`),
      overrideAsync('40-testplan', `vòng ${i}`),
    ])
    assert.equal(a, 0)
    assert.equal(b, 0)
    const st = readStateBlock(dir)
    assert.equal(st.stages['10-prd']?.override_count, i, `vòng ${i}: override 10-prd bị nuốt`)
    assert.equal(st.stages['40-testplan']?.override_count, i, `vòng ${i}: override 40-testplan bị nuốt`)
  }
})
