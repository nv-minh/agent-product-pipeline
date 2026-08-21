// tests/usage-sync.test.js — pp usage-sync: khai thác transcript Claude Code
// (~/.claude/projects/<munged-cwd>/*.jsonl) lấy token usage THẬT, gán về
// feature/theo stage. Luật chịu tải:
//  1. MỘT API response sinh nhiều dòng JSONL (mỗi content block một dòng) với
//     usage GIỐNG HỆT nhau → phải dedup theo (session, message.id), nếu không
//     token bị thổi phồng ~65% (đo thực tế trên transcript thật).
//  2. Idempotent: chạy hai lần thêm 0 mục.
//  3. Test KHÔNG BAO GIỜ quét ~/.claude thật — luôn truyền --transcripts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, makeRoot } from './helpers.js'
import { readAudit } from '../lib/audit.js'

// Cùng quy tắc munge như lib/usage.js: mọi ký tự không alphanumeric thành '-'
const munge = (p) => p.replace(/[^a-zA-Z0-9]/g, '-')

function mkTranscripts(tdir, root, sessions) {
  const proj = join(tdir, munge(root))
  mkdirSync(proj, { recursive: true })
  for (const [name, lines] of Object.entries(sessions)) {
    writeFileSync(join(proj, `${name}.jsonl`), lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n')
  }
  return proj
}

function assistant(root, sess, msgId, ts, usage, extra = {}) {
  return {
    type: 'assistant', timestamp: ts, sessionId: sess, cwd: root,
    message: { id: msgId, model: 'claude-opus-5', usage },
    isSidechain: false, ...extra,
  }
}

const U = (i, o, cr = 0, cc = 0) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cc })

// Cửa sổ: dispatch 10-prd mở lúc 09:55, sự kiện audit kế tiếp (gate) đóng
// lúc 10:30 → mọi entry 10:00–10:29 thuộc stage 10-prd.
function seedWindows(root, feature = 'demo') {
  appendFileSync(join(root, 'features', feature, 'audit.jsonl'), [
    { ts: '2026-08-19T09:55:00Z', v: 1, actor: 'pp', event: 'dispatch', feature, stage: '10-prd', details: { action: 'run' } },
    { ts: '2026-08-19T10:30:00Z', v: 1, actor: 'pp', event: 'gate', feature, stage: '10-prd', ok: true, details: { tier: 't1' } },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n')
}

function entriesOf(root, feature = 'demo') {
  return readFileSync(join(root, 'features', feature, '.usage', 'entries.jsonl'), 'utf8')
    .trimEnd().split('\n').map((l) => JSON.parse(l))
}

function setup() {
  const root = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  seedWindows(root)
  const tdir = mkdtempSync(join(tmpdir(), 'pp-usage-'))
  return { root, tdir }
}

test('dedup theo (session, message.id): dòng lặp của cùng response đếm MỘT lần; gán window + ghi sidechain', () => {
  const { root, tdir } = setup()
  mkTranscripts(tdir, root, {
    s1: [
      assistant(root, 's1', 'msg_A', '2026-08-19T10:05:00Z', U(100, 50)),
      assistant(root, 's1', 'msg_A', '2026-08-19T10:05:00Z', U(100, 50)), // dòng lặp cùng message.id
      'not json {{{', // dòng rác: bỏ qua
      assistant(root, 's1', 'msg_B', '2026-08-19T10:06:00Z', U(10, 5), { isSidechain: true }), // subagent trong cửa sổ
    ],
  })
  const r = run(['usage-sync', 'demo', '--transcripts', tdir, '--root', root])
  assert.equal(r.code, 0)
  assert.match(r.out, /usage-sync demo: \+2 mục/)
  const es = entriesOf(root)
  assert.equal(es.length, 2, 'msg_A phải gộp còn 1, cộng msg_B')
  assert.deepEqual(es.map((e) => e.id).sort(), ['s1:msg_A', 's1:msg_B'])
  for (const e of es) {
    assert.equal(e.attrib, 'window')
    assert.equal(e.stage, '10-prd')
    assert.equal(e.model, 'claude-opus-5')
  }
  assert.equal(es.find((e) => e.id === 's1:msg_B').sidechain, true)
  assert.equal(es.find((e) => e.id === 's1:msg_A').sidechain, false)
  // Rollup theo stage trong output: input 110 = 100 + 10
  assert.match(r.out, /10-prd\s+input 110 · output 55/)
})

test('mention fallback: ngoài cửa sổ nhưng dòng có features/demo → attrib mention, stage null; không nhắc → bỏ', () => {
  const { root, tdir } = setup()
  mkTranscripts(tdir, root, {
    s2: [
      { ...assistant(root, 's2', 'msg_C', '2026-08-19T11:30:00Z', U(7, 3)), tool_input: 'đọc features/demo/10-prd.md' },
      assistant(root, 's2', 'msg_D', '2026-08-19T11:45:00Z', U(999, 999)), // ngoài cửa sổ + không nhắc
    ],
  })
  const r = run(['usage-sync', 'demo', '--transcripts', tdir, '--root', root])
  assert.equal(r.code, 0)
  const es = entriesOf(root)
  assert.equal(es.length, 1, 'msg_D phải bị bỏ (scanned-only)')
  assert.equal(es[0].attrib, 'mention')
  assert.equal(es[0].stage, null)
})

test('idempotent: chạy lần hai thêm 0 mục, file không đổi', () => {
  const { root, tdir } = setup()
  mkTranscripts(tdir, root, { s1: [assistant(root, 's1', 'msg_A', '2026-08-19T10:05:00Z', U(100, 50))] })
  run(['usage-sync', 'demo', '--transcripts', tdir, '--root', root])
  const before = readFileSync(join(root, 'features/demo/.usage/entries.jsonl'), 'utf8')
  const r2 = run(['usage-sync', 'demo', '--transcripts', tdir, '--root', root])
  assert.equal(r2.code, 0)
  assert.match(r2.out, /\+0 mục/)
  assert.equal(readFileSync(join(root, 'features/demo/.usage/entries.jsonl'), 'utf8'), before)
})

test('--since ISO: chỉ lấy entry từ thời điểm trở đi; --since rác → exit 2', () => {
  const { root, tdir } = setup()
  mkTranscripts(tdir, root, {
    s1: [
      assistant(root, 's1', 'msg_A', '2026-08-19T10:05:00Z', U(100, 50)),
      { ...assistant(root, 's1', 'msg_C', '2026-08-19T11:30:00Z', U(7, 3)), tool_input: 'features/demo' },
    ],
  })
  const r = run(['usage-sync', 'demo', '--transcripts', tdir, '--since', '2026-08-19T11:00:00Z', '--root', root])
  assert.equal(r.code, 0)
  const es = entriesOf(root)
  assert.equal(es.length, 1)
  assert.equal(es[0].id, 's1:msg_C')
  const bad = run(['usage-sync', 'demo', '--transcripts', tdir, '--since', 'hôm qua', '--root', root])
  assert.equal(bad.code, 2)
})

test('thư mục transcript không tồn tại → exit 0 kèm ghi chú (thiếu dữ liệu không phải lỗi)', () => {
  const root = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  const r = run(['usage-sync', 'demo', '--transcripts', '/khong-ton-tai/o-dau', '--root', root])
  assert.equal(r.code, 0)
  assert.match(r.out, /không tìm thấy thư mục transcript/)
})

test('đối số sai → exit 2: thiếu feature; feature không có pipeline.json', () => {
  const root = makeRoot()
  assert.equal(run(['usage-sync', '--root', root]).code, 2)
  assert.equal(run(['usage-sync', 'chua-init', '--root', root]).code, 2)
})

test('cuối sync ghi audit event usage-sync với added/total/sessions', () => {
  const { root, tdir } = setup()
  mkTranscripts(tdir, root, {
    s1: [assistant(root, 's1', 'msg_A', '2026-08-19T10:05:00Z', U(100, 50))],
    s9: [assistant(root, 's9', 'msg_Z', '2026-08-19T10:07:00Z', U(1, 1))],
  })
  run(['usage-sync', 'demo', '--transcripts', tdir, '--root', root])
  const [e] = readAudit(join(root, 'features/demo')).filter((x) => x.event === 'usage-sync')
  assert.equal(e.actor, 'pp')
  assert.equal(e.details.added, 2)
  assert.equal(e.details.total, 2)
  assert.equal(e.details.sessions, 2)
})

// ─── D5 — ba lỗ đo đạc: chỉ quét product-repo, cwd so tuyệt đối, mention substring ───

test('D5: --repos quét thêm transcript của repo code — nơi phần việc nặng nhất sống', () => {
  const { root, tdir } = setup()
  const backend = mkdtempSync(join(tmpdir(), 'pp-backend-'))
  // Phiên viết code: cwd là BACKEND repo, nằm trong dir munge của backend.
  mkTranscripts(tdir, backend, {
    code1: [assistant(backend, 'code1', 'msg_K', '2026-08-19T10:10:00Z', U(500, 200))],
  })
  // Không --repos: không thấy gì (đúng lỗ hổng cũ) — dir munge của product-repo
  // còn chưa tồn tại, phiên backend hoàn toàn vô hình.
  const blind = run(['usage-sync', 'demo', '--transcripts', tdir, '--root', root])
  assert.equal(blind.code, 0)
  assert.match(blind.out, /không tìm thấy thư mục transcript/)
  // Có --repos: entry của backend được gán vào cửa sổ 10-prd của feature.
  // Dir munge của product-root tồn tại (0 file) để cả HAI repo đều được quét.
  mkTranscripts(tdir, root, {})
  const r = run(['usage-sync', 'demo', '--transcripts', tdir, '--repos', backend, '--root', root])
  assert.equal(r.code, 0)
  const es = entriesOf(root)
  assert.equal(es.length, 1)
  assert.equal(es[0].stage, '10-prd')
  assert.match(r.out, /2 repo/)
})

test('D5: repo khai trong --repos chưa có transcript — nói rõ rồi bỏ qua, không im lặng', () => {
  const { root, tdir } = setup()
  mkTranscripts(tdir, root, { s1: [assistant(root, 's1', 'msg_A', '2026-08-19T10:05:00Z', U(1, 1))] })
  const r = run(['usage-sync', 'demo', '--transcripts', tdir, '--repos', '/chua/co/repo-nay', '--root', root])
  assert.equal(r.code, 0)
  assert.match(r.out, /không có transcript ở .*chua-co-repo-nay.*bỏ qua/)
  assert.equal(entriesOf(root).length, 1)
})

test('D5: session mở ở SUBDIR của repo (cwd sâu hơn root) không còn bị loại', () => {
  const { root, tdir } = setup()
  mkTranscripts(tdir, root, {
    s1: [assistant(join(root, 'features', 'demo'), 's1', 'msg_S', '2026-08-19T10:05:00Z', U(11, 22))],
  })
  const r = run(['usage-sync', 'demo', '--transcripts', tdir, '--root', root])
  assert.equal(r.code, 0)
  assert.equal(entriesOf(root).length, 1, 'cwd là subdir của root phải được nhận (so prefix)')
})

test('D5: mention có ranh giới segment — feature "auth" không hút dòng của "auth-v2"', () => {
  const root = makeRoot()
  run(['init', 'auth', '--size', 'S', '--root', root])
  const tdir = mkdtempSync(join(tmpdir(), 'pp-usage-'))
  mkTranscripts(tdir, root, {
    s1: [
      // Ngoài mọi cửa sổ (không seed audit) → chỉ còn đường mention.
      { ...assistant(root, 's1', 'msg_V2', '2026-08-19T11:00:00Z', U(999, 999)), tool_input: 'đọc features/auth-v2/10-prd.md' },
      { ...assistant(root, 's1', 'msg_OK', '2026-08-19T11:01:00Z', U(5, 5)), tool_input: 'đọc features/auth/10-prd.md' },
    ],
  })
  const r = run(['usage-sync', 'auth', '--transcripts', tdir, '--root', root])
  assert.equal(r.code, 0)
  const es = entriesOf(root, 'auth')
  assert.equal(es.length, 1, `auth-v2 phải bị bỏ, nhận: ${es.map((e) => e.id).join(', ')}`)
  assert.equal(es[0].id, 's1:msg_OK')
})

test('D5: output nói thẳng giới hạn heuristic của phép gán', () => {
  const { root, tdir } = setup()
  mkTranscripts(tdir, root, { s1: [assistant(root, 's1', 'msg_A', '2026-08-19T10:05:00Z', U(1, 1))] })
  const r = run(['usage-sync', 'demo', '--transcripts', tdir, '--root', root])
  assert.match(r.out, /heuristic/)
  assert.match(r.out, /đừng cộng token GIỮA các feature/)
})

test('PP_TRANSCRIPTS env là seam thứ hai khi không có --transcripts', () => {
  const { root, tdir } = setup()
  mkTranscripts(tdir, root, { s1: [assistant(root, 's1', 'msg_A', '2026-08-19T10:05:00Z', U(100, 50))] })
  const r = run(['usage-sync', 'demo', '--root', root], { env: { ...process.env, PP_TRANSCRIPTS: tdir } })
  assert.equal(r.code, 0)
  assert.equal(entriesOf(root).length, 1)
})
