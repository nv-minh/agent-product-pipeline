// C5 — GỐC GIẢI NGHĨA CITE PATH PHẢI CẤU HÌNH ĐƯỢC.
// Trụ cột 3 (§6) "neo vào code thật" chạy `existsSync` trên mọi đường dẫn được
// cite trong artifact. Gốc để giải nghĩa các path đó từng bị hardcode
// `join(root, '..')` — đúng với layout A (product-repo nằm CẠNH backend-repo/
// web-repo) và sai ở mọi layout khác: clone product-repo vào ~/Desktop thì mọi
// cite bị kiểm ngược vào ~/Desktop và gate chống ảo giác đỏ oan toàn bộ.
// Các test dưới đây khoá cả hành vi mặc định (không được đổi) lẫn đường ghi đè.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run, QUESTIONS, PRD } from './helpers.js'

// PRD sạch với T1 + cite đúng MỘT đường dẫn tương đối. `LOOKS_LIKE_PATH` khớp
// `src/demo/thing.ts` (có `/`, có đuôi, segment đầu không chứa dấu chấm), nên
// check `cited-paths` thực sự soi nó.
const CITE = 'src/demo/thing.ts'
const PRD_WITH_CITE = PRD.replace(
  '## Out of scope',
  `Hiện thực neo vào \`${CITE}\`.\n\n## Out of scope`,
)

function seed(root, feature = 'demo') {
  const r = run(['init', feature, '--root', root])
  assert.equal(r.code, 0, `init phải xanh, nhận:\n${r.out}`)
  const dir = join(root, 'features', feature)
  writeFileSync(join(dir, '10-questions.md'), QUESTIONS)
  writeFileSync(join(dir, '10-prd.md'), PRD_WITH_CITE)
  return dir
}

test('mặc định: cite được giải nghĩa theo thư mục CHA của root (layout A, không đổi hành vi)', () => {
  const root = makeRoot()
  seed(root)
  // Cha của root là thư mục tạm hệ thống — không có src/demo/thing.ts ở đó.
  const r = run(['gate', 'demo', '10-prd', '--root', root])
  assert.equal(r.code, 1, `phải đỏ vì cite không tồn tại, nhận:\n${r.out}`)
  assert.match(r.out, /cite đường dẫn không tồn tại/)
  assert.match(r.out, /src\/demo\/thing\.ts/)
})

test('--workspace trỏ đúng chỗ thì cite tồn tại và gate xanh', () => {
  const root = makeRoot()
  seed(root)
  // Đặt file được cite BÊN TRONG root, rồi khai root chính là workspace.
  mkdirSync(join(root, 'src', 'demo'), { recursive: true })
  writeFileSync(join(root, CITE), 'export const thing = 1\n')

  const red = run(['gate', 'demo', '10-prd', '--root', root])
  assert.equal(red.code, 1, 'không có --workspace thì vẫn phải đỏ')

  const green = run(['gate', 'demo', '10-prd', '--root', root, '--workspace', root])
  assert.equal(green.code, 0, `có --workspace thì phải xanh, nhận:\n${green.out}`)
  assert.doesNotMatch(green.out, /cite đường dẫn không tồn tại/)
})

test('--workspace sai chỗ thì cite vẫn đỏ — flag không phải cách tắt gate', () => {
  const root = makeRoot()
  seed(root)
  mkdirSync(join(root, 'src', 'demo'), { recursive: true })
  writeFileSync(join(root, CITE), 'export const thing = 1\n')

  const r = run(['gate', 'demo', '10-prd', '--root', root, '--workspace', join(root, 'schema')])
  assert.equal(r.code, 1, `workspace sai thì phải đỏ, nhận:\n${r.out}`)
  assert.match(r.out, /cite đường dẫn không tồn tại/)
})

test('PP_WORKSPACE có tác dụng như --workspace', () => {
  const root = makeRoot()
  seed(root)
  mkdirSync(join(root, 'src', 'demo'), { recursive: true })
  writeFileSync(join(root, CITE), 'export const thing = 1\n')

  const r = run(['gate', 'demo', '10-prd', '--root', root], {
    env: { ...process.env, PP_WORKSPACE: root },
  })
  assert.equal(r.code, 0, `PP_WORKSPACE phải có tác dụng, nhận:\n${r.out}`)
})

test('--workspace thắng PP_WORKSPACE khi cả hai có mặt', () => {
  const root = makeRoot()
  seed(root)
  mkdirSync(join(root, 'src', 'demo'), { recursive: true })
  writeFileSync(join(root, CITE), 'export const thing = 1\n')

  // env trỏ đúng, flag trỏ sai → flag phải thắng, tức là đỏ.
  const r = run(['gate', 'demo', '10-prd', '--root', root, '--workspace', join(root, 'schema')], {
    env: { ...process.env, PP_WORKSPACE: root },
  })
  assert.equal(r.code, 1, `--workspace phải thắng PP_WORKSPACE, nhận:\n${r.out}`)
})

// Cùng luật với `--root`: một flag đứng cuối dòng lệnh (không có giá trị theo
// sau) được parseArgs trả về boolean `true`, không được để `resolve(true)` ném
// TypeError — phải rơi về mặc định.
test('--workspace không có giá trị thì rơi về mặc định, không crash', () => {
  const root = makeRoot()
  seed(root)
  const r = run(['gate', 'demo', '10-prd', '--root', root, '--workspace'])
  assert.equal(r.code, 1, `phải đỏ theo mặc định, nhận:\n${r.out}`)
  assert.doesNotMatch(r.out, /TypeError/)
  assert.match(r.out, /cite đường dẫn không tồn tại/)
})
