// B2 + B3 — HAI LUẬT ĐƯỢC VIẾT TRONG SPEC/SCHEMA MÀ KHÔNG DÒNG CODE NÀO THI HÀNH.
//
// B2  spec §5.1: "Chung mọi artifact: … frontmatter hợp lệ (feature, stage,
//     updated, source) …". `grep -rn frontmatter lib/` = 0 dòng. Tái lập được:
//     ghi đúng fixture PRD sạch nhưng CẮT BỎ frontmatter → `pp gate` exit 0.
//
// B3  schema/40-testplan.json khai `edgeCaseChecklist` 11 mục, nằm ngay cạnh
//     `requiredTcAttrs`/`requiredTcFields` là hai key ĐƯỢC thi hành. Không code
//     nào đọc nó. Một người đọc schema sẽ tin rằng 11 mục biên đang được gate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run, passT1Prd, completePrd, PRD, QUESTIONS, TESTPLAN } from './helpers.js'

function feature() {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  return { r0, dir: join(r0, 'features/demo') }
}

// Ghi PRD (đã sạch với mọi check khác) rồi gate — để thứ DUY NHẤT khác nhau giữa
// đỏ và xanh là phần frontmatter.
function gatePrd(r0, dir, prdText) {
  writeFileSync(join(dir, '10-questions.md'), QUESTIONS)
  writeFileSync(join(dir, '10-prd.md'), prdText)
  return run(['gate', 'demo', '10-prd', '--root', r0])
}

const stripFrontmatter = (t) => t.replace(/^---\n[\s\S]*?\n---\n\n/, '')

// ─── B2 ───────────────────────────────────────────────────────────────────

test('B2: PRD không có frontmatter thì T1 ĐỎ (trước bản vá: xanh)', () => {
  const { r0, dir } = feature()
  const r = gatePrd(r0, dir, stripFrontmatter(PRD))
  assert.equal(r.code, 1)
  assert.match(r.out, /thiếu frontmatter ở đầu file/)
  // Thông báo phải nói ra ĐỦ bốn key cần viết, không bắt người đọc đi tra spec.
  for (const k of ['feature', 'stage', 'updated', 'source']) assert.match(r.out, new RegExp(k))
})

test('B2: frontmatter đúng thì xanh — luật này không phải cái bẫy', () => {
  const { r0, dir } = feature()
  assert.equal(gatePrd(r0, dir, PRD).code, 0)
})

test('B2: artifact copy từ feature khác bị bắt, dù nội dung sạch tuyệt đối', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'thanh-toan', '--size', 'S', '--root', r0]).code, 0)
  const dir = join(r0, 'features/thanh-toan')
  writeFileSync(join(dir, '10-questions.md'), QUESTIONS)
  // `feature: demo` — đúng cái dấu vết mà một lần copy artifact để lại.
  writeFileSync(join(dir, '10-prd.md'), PRD)
  const r = run(['gate', 'thanh-toan', '10-prd', '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /feature: "demo" không khớp "thanh-toan"/)
  assert.match(r.out, /bạn đang copy từ chỗ khác/)
})

test('B2: khai sai stage, thiếu key, và updated sai dạng — mỗi cái một thông báo riêng', () => {
  const { r0, dir } = feature()

  const wrongStage = gatePrd(r0, dir, PRD.replace('stage: 10-prd', 'stage: 40-testplan'))
  assert.equal(wrongStage.code, 1)
  assert.match(wrongStage.out, /stage: "40-testplan" không khớp "10-prd"/)

  const noSource = gatePrd(r0, dir, PRD.replace('source: 00-brief.md\n', ''))
  assert.equal(noSource.code, 1)
  assert.match(noSource.out, /frontmatter thiếu "source"/)

  const emptySource = gatePrd(r0, dir, PRD.replace('source: 00-brief.md', 'source:'))
  assert.equal(emptySource.code, 1)
  assert.match(emptySource.out, /frontmatter "source" bỏ trống/)

  const badDate = gatePrd(r0, dir, PRD.replace('updated: 2026-08-20', 'updated: hôm qua'))
  assert.equal(badDate.code, 1)
  assert.match(badDate.out, /updated: "hôm qua" không phải ngày/)
})

test('B2: frontmatter phải ở ĐẦU file — một khối `---` giữa bài không tính', () => {
  const { r0, dir } = feature()
  const r = gatePrd(r0, dir, `# PRD — demo\n\n${PRD}`)
  assert.equal(r.code, 1)
  assert.match(r.out, /thiếu frontmatter ở đầu file/)
})

// ─── B3 ───────────────────────────────────────────────────────────────────

test('B3: testplan thiếu "## Edge cases" thì T1 ĐỎ và liệt kê đủ mục phải kết luận', () => {
  const { r0, dir } = feature()
  completePrd(r0)
  const r = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r.code, 1)

  writeFileSync(join(dir, '40-testplan.md'), TESTPLAN.replace(/## Edge cases[\s\S]*$/, ''))
  const noSection = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(noSection.code, 1)
  assert.match(noSection.out, /pp-check edge-cases/)
  assert.match(noSection.out, /không tìm thấy heading "## Edge cases"/)
  // Một dòng duy nhất thay vì lặp 11 lần cùng lý do (lab 2026-08-21) — mỗi mục
  // chỉ được liệt kê riêng khi heading ĐÃ có mà mục đó thiếu kết luận.
  assert.match(noSection.out, /11 mục edge case chưa kiểm được/)
})

test('B3: "không áp dụng vì …" là kết luận hợp lệ — check này không ép viết test rác', () => {
  const { r0, dir } = feature()
  completePrd(r0)
  writeFileSync(join(dir, '40-testplan.md'), TESTPLAN)
  // Fixture TESTPLAN kết luận ba mục số bằng "không áp dụng vì payload không có
  // field số" — và vẫn phải xanh.
  const r = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r.code, 0, r.out)
})

test('B3: một mục bỏ trống bị bắt đích danh, không lẫn vào mục khác', () => {
  const { r0, dir } = feature()
  completePrd(r0)
  writeFileSync(join(dir, '40-testplan.md'), TESTPLAN.replace(
    '- trùng lặp: hai bản ghi giống nhau là hợp lệ, không chặn.',
    '- trùng lặp:',
  ))
  const r = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /mục edge case "trùng lặp" bỏ trống/)
  assert.doesNotMatch(r.out, /mục edge case "null"/)
})

test('B3: kết luận nằm trong khối ``` hoặc ngoài section thì không được tính', () => {
  const { r0, dir } = feature()
  completePrd(r0)

  const fenced = TESTPLAN.replace(
    '- sai định dạng: body không phải JSON trả 400.',
    '```\n- sai định dạng: body không phải JSON trả 400.\n```',
  )
  writeFileSync(join(dir, '40-testplan.md'), fenced)
  const r1 = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r1.code, 1)
  assert.match(r1.out, /thiếu mục edge case "sai định dạng"/)

  // Cùng một dòng, dời xuống một section KHÁC: cũng không tính.
  const moved = TESTPLAN
    .replace('- sai định dạng: body không phải JSON trả 400.\n', '')
    .concat('\n## Ghi chú\n\n- sai định dạng: body không phải JSON trả 400.\n')
  writeFileSync(join(dir, '40-testplan.md'), moved)
  const r2 = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r2.code, 1)
  assert.match(r2.out, /thiếu mục edge case "sai định dạng"/)
})

// GIỚI HẠN — khoá thành test để không ai đọc bộ check này rồi tưởng T1 đang
// kiểm CHẤT LƯỢNG của kết luận. Nó chỉ kiểm rằng mỗi mục biên ĐÃ ĐƯỢC KẾT LUẬN
// bằng một chữ gì đó. "có thoả đáng không" là việc của rubric T2 — đó là phân
// vai cố ý giữa hai tầng, không phải chỗ còn sót.
test('GIỚI HẠN đã biết: một kết luận vô nghĩa vẫn qua được T1', () => {
  const { r0, dir } = feature()
  completePrd(r0)
  writeFileSync(join(dir, '40-testplan.md'), TESTPLAN.replace(
    '- gọi đồng thời: hai tab gửi cùng lúc tạo hai bản ghi độc lập.',
    '- gọi đồng thời: x',
  ))
  const r = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r.code, 0, 'đây là giới hạn đã biết, không phải hồi quy — xem rubric/40-testplan.md')
})

// Một luật được thi hành mà chỉ thị không hề nhắc tới là cái bẫy: agent viết
// artifact, gate đỏ vì một thứ chưa ai nói, và vòng lặp đó tạo áp lực override —
// đúng tín hiệu §10.4 dùng để kết luận "gate này sai". Chỉ thị phải nói trước.
test('B2/B3: chỉ thị pp advance nêu frontmatter và heading bắt buộc lấy từ schema', () => {
  const { r0 } = feature()
  const prd = run(['advance', 'demo', '--root', r0])
  assert.match(prd.out, /frontmatter, đúng bốn khoá/)
  assert.match(prd.out, /feature: demo/)
  assert.match(prd.out, /stage: 10-prd/)
  assert.match(prd.out, /source: 00-brief\.md/)
  assert.match(prd.out, /Heading bắt buộc : ## User stories · ## Out of scope · ## Rủi ro/)

  completePrd(r0)
  const plan = run(['advance', 'demo', '--root', r0])
  assert.match(plan.out, /Heading bắt buộc : ## Test cases · ## Edge cases/)
  assert.match(plan.out, /source: 10-prd\.md/)
})

// `pp advance` đọc schema chỉ ĐỂ IN. Một schema méo phải được báo đúng chỗ (khi
// gate chạy), không được làm chết cả lệnh in chỉ thị — nếu không thì một file
// schema lỗi khiến pipeline không còn nói được bước kế tiếp là gì.
test('B2/B3: schema méo không làm pp advance chết, chỉ mất dòng heading', () => {
  const { r0 } = feature()
  writeFileSync(join(r0, 'schema/10-prd.json'), '{ đây không phải JSON')
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /CHỈ THỊ CHO STAGE 10-prd/)
  assert.doesNotMatch(r.out, /Heading bắt buộc/)
})

// Fixture của bộ test phải đi qua chính luật mà nó đang giúp kiểm — nếu không,
// mọi test dùng nó đều đang chạy trên một artifact mà gate thật sẽ từ chối.
test('fixture PRD/TESTPLAN của bộ test tự thoả B2 + B3', () => {
  const { r0, dir } = feature()
  assert.equal(passT1Prd(r0).code, 0)
  completePrd(r0)
  writeFileSync(join(dir, '40-testplan.md'), TESTPLAN)
  assert.equal(run(['gate', 'demo', '40-testplan', '--root', r0]).code, 0)
})
