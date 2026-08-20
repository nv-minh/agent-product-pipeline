# Agent Product Pipeline — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng `pp` — conductor tất định điều khiển pipeline sản phẩm qua các stage, với gate T1 (script) + T2 (reviewer đối kháng) cho hai stage đau nhất `10-prd` và `40-testplan`, và hooks biến gate thành luật.

**Architecture:** Ba lớp — toolbox (`dev-ba-kit` 63 skill + `herdr`, không sửa) · blackboard (file trong `pinnacle-product/features/<name>/`) · conductor (`bin/pp`, Node zero-dep). `pp` đọc `pipeline.json` + `STATE.md`, quyết định stage kế tiếp, chạy gate, ghi `.evidence/`. Không thực thể LLM nào được ghi `STATE.md` hay `.evidence/`.

**Tech Stack:** Node.js ≥18 (builtin `node:test`, `node:assert/strict`, `node:crypto`, `node:fs`), zero npm dependency. Config JSON. Claude Code hooks (`Stop`, `PreToolUse`) dạng shell gọi `pp`.

**Spec:** `docs/specs/2026-08-18-agent-product-pipeline-design.md`

## Global Constraints

- **Runtime:** Node.js ≥18. **Zero npm dependency** — chỉ builtin. `package.json` có `"type": "module"`, không có `dependencies`.
- **Deviation từ spec (có chủ đích):** spec §3 ghi `bin/pp` là shell và config `pipeline.yml`; plan này dùng **Node + `pipeline.json`**. Lý do: shell/Python đều cần cài thêm parser YAML. Tính tất định giữ nguyên. Muốn về YAML: thêm parser trong `lib/config.js`, phần còn lại không đổi.
- **Test:** `node --test tests/` — chạy từ gốc `pinnacle-product`. Mọi task kết thúc bằng test xanh.
- **Không thực thể LLM nào được ghi `STATE.md` hoặc `.evidence/`** (Constitution Điều 5). Chỉ `bin/pp`.
- **Hoàn thành là dữ kiện, không phải lời khai** (Điều 2): stage chỉ `done` khi evidence không chứa `Exit status:` khác 0.
- **AC viết EARS**, đúng một `SHALL` mỗi AC (Điều 6).
- **Commit theo Conventional Commits** `type(scope): description`. Repo này không có commit-msg hook — tự giữ kỷ luật.
- **Simplicity (Điều 1):** không thêm lớp trừu tượng nào không có ≥3 chỗ dùng.
- Mọi đường dẫn trong plan tính từ gốc repo `pinnacle-product/`.

## Phạm vi Phase 1

| Trong phạm vi | Ngoài phạm vi (Plan 2/3) |
|---|---|
| `pp init/status/advance/gate/approve/override/unblock/report` | `pp handoff` + mối nối Herdr |
| Stage `10-prd`, `40-testplan` (T1 + T2) | Stage `30-contract`, `50-security`, `70-ops` |
| Hooks `Stop` + `PreToolUse` | `90-archive`, vòng lặp `lessons` |
| Bootstrap fixtures từ `dev-ba-kit` | Chấm điểm, `pp size`, `pp board` |

Trong Phase 1, feature mẫu tắt `30-contract` nên `40-testplan` chỉ dẫn xuất từ `10-prd`. Input `"30-contract.md?"` có dấu `?` = optional, vắng thì bỏ qua.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `package.json` | `{"type":"module"}`, script `test`. Không dependency |
| `bin/pp` | CLI entry: parse argv, dispatch sang lệnh, set exit code. Không chứa logic nghiệp vụ |
| `lib/config.js` | Đọc + validate `pipeline.json`. Chuẩn hoá `inputs` (tách hậu tố `?` optional) |
| `lib/state.js` | Đọc/ghi `STATE.md` (khối JSON nhúng + bảng cho người). Băm inputs. Phát hiện `stale` |
| `lib/evidence.js` | Ghi `.evidence/<stage>.log` theo định dạng cố định. `hasFailure()` quét `Exit status:` khác 0 |
| `lib/plan.js` | Hàm thuần `nextStage(config, state)` → stage kế tiếp + hành động + lý do |
| `lib/gate.js` | Chạy danh sách check của một stage, ghi evidence, trả exit code |
| `lib/checks/common.js` | Check dùng chung: placeholder · frontmatter · heading bắt buộc · path được cite có tồn tại |
| `lib/checks/prd.js` | Check riêng `10-prd`: id US/AC · EARS · out-of-scope · checklist rủi ro · questions đã trả lời |
| `lib/checks/testplan.js` | Check riêng `40-testplan`: traceability · schema TC · tỉ lệ loại test · bảng edge case |
| `lib/commands/*.js` | Một file một lệnh CLI |
| `schema/10-prd.json`, `schema/40-testplan.json` | Heading bắt buộc + regex ID, tách khỏi code |
| `rubric/10-prd.md`, `rubric/40-testplan.md` | Tiêu chí đạt/trượt cho T2 reviewer |
| `hooks/stop.sh`, `hooks/pre-tool-use.sh` | Hook Claude Code gọi `pp` |
| `agents/pp-reviewer.md` | Subagent T2 đối kháng |
| `commands/pp.md` | Slash command `/pp` |
| `tests/fixtures/` | Output THẬT của `dev-ba-kit` thu ở Task 8 |
| `tests/*.test.js` | Test cho từng module |

---

## Task 1: CLI khung + `package.json`

**Files:**
- Create: `package.json`
- Create: `bin/pp`
- Test: `tests/cli.test.js`

**Interfaces:**
- Consumes: —
- Produces: `bin/pp` chạy được, exit code 2 khi thiếu lệnh, exit 0 khi `--help`. Bảng dispatch `COMMANDS` là nơi các task sau đăng ký lệnh mới.

- [ ] **Step 1: Viết test thất bại**

```js
// tests/cli.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const PP = new URL('../bin/pp', import.meta.url).pathname

function run(args) {
  try {
    const stdout = execFileSync('node', [PP, ...args], { encoding: 'utf8' })
    return { code: 0, stdout }
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || '') + (e.stderr || '') }
  }
}

test('không có lệnh thì in usage và exit 2', () => {
  const r = run([])
  assert.equal(r.code, 2)
  assert.match(r.stdout, /Usage: pp <command>/)
})

test('--help exit 0', () => {
  const r = run(['--help'])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /Usage: pp <command>/)
})

test('lệnh lạ thì exit 2 và nêu tên lệnh', () => {
  const r = run(['khong-ton-tai'])
  assert.equal(r.code, 2)
  assert.match(r.stdout, /khong-ton-tai/)
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `cd /path/to/agent-product-pipeline && node --test tests/cli.test.js`
Expected: FAIL — `bin/pp` chưa tồn tại (`ENOENT`).

- [ ] **Step 3: Viết implementation tối thiểu**

```json
// package.json
{
  "name": "pinnacle-product",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": { "test": "node --test tests/" }
}
```

```js
#!/usr/bin/env node
// bin/pp
const COMMANDS = {}   // các task sau đăng ký: COMMANDS.init = initCmd

const USAGE = `Usage: pp <command> [options]

Commands:
  (chưa có lệnh nào — sẽ thêm ở các task sau)

Options:
  --help    In trợ giúp này
`

async function main(argv) {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(USAGE)
    return cmd ? 0 : 2
  }
  const handler = COMMANDS[cmd]
  if (!handler) {
    process.stdout.write(`pp: không biết lệnh "${cmd}"\n\n${USAGE}`)
    return 2
  }
  return await handler(rest)
}

main(process.argv.slice(2))
  .then((code) => process.exit(code ?? 0))
  .catch((err) => { process.stderr.write(`pp: ${err.message}\n`); process.exit(1) })
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `chmod +x bin/pp && node --test tests/cli.test.js`
Expected: PASS — 3 test xanh.

- [ ] **Step 5: Commit**

```bash
git add package.json bin/pp tests/cli.test.js
git commit -m "feat(pp): CLI khung với bảng dispatch và exit code"
```

---

## Task 2: Đọc và validate `pipeline.json`

**Files:**
- Create: `lib/config.js`
- Test: `tests/config.test.js`
- Create: `tests/fixtures/minimal/pipeline.json`

**Interfaces:**
- Consumes: —
- Produces:
  - `readConfig(featureDir: string): Config` — ném `Error` nếu thiếu field bắt buộc
  - `Config = { feature: string, size: string, stages: Record<string, Stage> }`
  - `Stage = { id, enabled, skills: string[], inputs: Input[], outputs: string[], gate: string[], human: boolean, budget?: object, handoff?: string }`
  - `Input = { path: string, optional: boolean }`
  - `stageOrder(config): string[]` — id stage sắp xếp tăng dần theo tiền tố số

- [ ] **Step 1: Viết test thất bại**

```js
// tests/config.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readConfig, stageOrder } from '../lib/config.js'

const DIR = new URL('./fixtures/minimal/', import.meta.url).pathname

test('đọc được config tối thiểu', () => {
  const c = readConfig(DIR)
  assert.equal(c.feature, 'demo')
  assert.equal(c.stages['10-prd'].enabled, true)
  assert.deepEqual(c.stages['10-prd'].skills, ['prd-epic'])
})

test('hậu tố ? đánh dấu input optional', () => {
  const c = readConfig(DIR)
  assert.deepEqual(c.stages['40-testplan'].inputs, [
    { path: '10-prd.md', optional: false },
    { path: '30-contract.md', optional: true },
  ])
})

test('stage thiếu field bắt buộc thì ném lỗi nêu rõ tên stage', () => {
  assert.throws(
    () => readConfig(new URL('./fixtures/broken/', import.meta.url).pathname),
    /50-security.*outputs/s,
  )
})

test('stageOrder sắp xếp theo tiền tố số', () => {
  assert.deepEqual(stageOrder(readConfig(DIR)), ['10-prd', '40-testplan'])
})
```

- [ ] **Step 2: Tạo fixture rồi chạy test để chắc chắn nó fail**

```bash
mkdir -p tests/fixtures/minimal tests/fixtures/broken
cat > tests/fixtures/minimal/pipeline.json <<'JSON'
{
  "feature": "demo",
  "size": "S",
  "stages": {
    "10-prd": {
      "enabled": true,
      "skills": ["prd-epic"],
      "inputs": ["00-brief.md"],
      "outputs": ["10-prd.md"],
      "gate": ["t1"],
      "human": true
    },
    "40-testplan": {
      "enabled": true,
      "skills": ["test-cases"],
      "inputs": ["10-prd.md", "30-contract.md?"],
      "outputs": ["40-testplan.md"],
      "gate": ["t1"],
      "human": false
    }
  }
}
JSON
cat > tests/fixtures/broken/pipeline.json <<'JSON'
{
  "feature": "broken",
  "size": "S",
  "stages": {
    "50-security": { "enabled": true, "inputs": ["10-prd.md"], "gate": ["t1"] }
  }
}
JSON
node --test tests/config.test.js
```
Expected: FAIL — `lib/config.js` chưa tồn tại.

- [ ] **Step 3: Viết implementation tối thiểu**

```js
// lib/config.js
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REQUIRED_STAGE_FIELDS = ['enabled', 'inputs', 'outputs', 'gate']

function parseInput(raw) {
  const optional = raw.endsWith('?')
  return { path: optional ? raw.slice(0, -1) : raw, optional }
}

export function readConfig(featureDir) {
  const file = join(featureDir, 'pipeline.json')
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`không đọc được ${file}: ${e.message}`)
  }
  for (const k of ['feature', 'stages']) {
    if (!raw[k]) throw new Error(`${file}: thiếu field "${k}"`)
  }
  const stages = {}
  for (const [id, s] of Object.entries(raw.stages)) {
    for (const f of REQUIRED_STAGE_FIELDS) {
      if (s[f] === undefined) throw new Error(`${file}: stage "${id}" thiếu field "${f}"`)
    }
    stages[id] = {
      id,
      enabled: s.enabled,
      skills: s.skills ?? [],
      inputs: s.inputs.map(parseInput),
      outputs: s.outputs,
      gate: s.gate,
      human: s.human ?? false,
      budget: s.budget,
      handoff: s.handoff,
    }
  }
  return { feature: raw.feature, size: raw.size ?? 'M', stages }
}

export function stageOrder(config) {
  return Object.keys(config.stages).sort(
    (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
  )
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `node --test tests/config.test.js`
Expected: PASS — 4 test xanh.

- [ ] **Step 5: Commit**

```bash
git add lib/config.js tests/config.test.js tests/fixtures/
git commit -m "feat(pp): đọc và validate pipeline.json"
```

---

## Task 3: `STATE.md` — đọc, ghi, băm input, phát hiện stale

**Files:**
- Create: `lib/state.js`
- Test: `tests/state.test.js`

**Interfaces:**
- Consumes: `readConfig`, `stageOrder` từ `lib/config.js`
- Produces:
  - `readState(featureDir): State` — không có file thì trả state rỗng `{ feature, stages: {} }`
  - `writeState(featureDir, state): void` — ghi `STATE.md` gồm bảng cho người + khối `<!-- pp:state … -->` cho máy
  - `hashInputs(featureDir, inputs): string` — sha256 rút gọn 6 ký tự; input optional vắng mặt thì bỏ qua
  - `isStale(featureDir, config, state, stageId): boolean`
  - `StageState = { status, attempts, gate, human, inputs_hash, evidence, overridden, reason }`
  - `status ∈ 'pending' | 'in_progress' | 'failed' | 'blocked' | 'stale' | 'skipped' | 'done'`

- [ ] **Step 1: Viết test thất bại**

```js
// tests/state.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readState, writeState, hashInputs, isStale } from '../lib/state.js'

function tmpFeature() {
  const d = mkdtempSync(join(tmpdir(), 'pp-'))
  writeFileSync(join(d, '00-brief.md'), 'brief v1\n')
  writeFileSync(join(d, '10-prd.md'), 'prd\n')
  return d
}

test('chưa có STATE.md thì trả state rỗng', () => {
  const d = tmpFeature()
  assert.deepEqual(readState(d).stages, {})
})

test('ghi rồi đọc lại giữ nguyên dữ liệu', () => {
  const d = tmpFeature()
  writeState(d, { feature: 'demo', current: '10-prd', stages: { '10-prd': { status: 'done', attempts: 2 } } })
  const s = readState(d)
  assert.equal(s.stages['10-prd'].status, 'done')
  assert.equal(s.stages['10-prd'].attempts, 2)
})

test('STATE.md có cảnh báo DO NOT EDIT và bảng cho người đọc', () => {
  const d = tmpFeature()
  writeState(d, { feature: 'demo', current: '10-prd', stages: { '10-prd': { status: 'done' } } })
  const txt = readFileSync(join(d, 'STATE.md'), 'utf8')
  assert.match(txt, /DO NOT EDIT/)
  assert.match(txt, /\| 10-prd \|/)
})

test('hashInputs đổi khi nội dung input đổi', () => {
  const d = tmpFeature()
  const inputs = [{ path: '00-brief.md', optional: false }]
  const h1 = hashInputs(d, inputs)
  writeFileSync(join(d, '00-brief.md'), 'brief v2\n')
  assert.notEqual(h1, hashInputs(d, inputs))
})

test('input optional vắng mặt không làm hỏng hash', () => {
  const d = tmpFeature()
  const inputs = [{ path: '00-brief.md', optional: false }, { path: 'khong-co.md', optional: true }]
  assert.equal(typeof hashInputs(d, inputs), 'string')
})

test('input bắt buộc vắng mặt thì ném lỗi', () => {
  const d = tmpFeature()
  assert.throws(() => hashInputs(d, [{ path: 'thieu.md', optional: false }]), /thieu\.md/)
})

test('isStale = true khi input đổi sau khi stage đã done', () => {
  const d = tmpFeature()
  const config = { stages: { '40-testplan': { id: '40-testplan', inputs: [{ path: '10-prd.md', optional: false }] } } }
  const state = { stages: { '40-testplan': { status: 'done', inputs_hash: hashInputs(d, config.stages['40-testplan'].inputs) } } }
  assert.equal(isStale(d, config, state, '40-testplan'), false)
  writeFileSync(join(d, '10-prd.md'), 'prd đã sửa\n')
  assert.equal(isStale(d, config, state, '40-testplan'), true)
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `node --test tests/state.test.js`
Expected: FAIL — `lib/state.js` chưa tồn tại.

- [ ] **Step 3: Viết implementation tối thiểu**

```js
// lib/state.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const FILE = 'STATE.md'
const OPEN = '<!-- pp:state'
const CLOSE = '-->'

export function readState(featureDir) {
  const file = join(featureDir, FILE)
  if (!existsSync(file)) return { feature: null, current: null, stages: {} }
  const txt = readFileSync(file, 'utf8')
  const i = txt.indexOf(OPEN)
  if (i === -1) throw new Error(`${file}: thiếu khối ${OPEN} — file có thể đã bị sửa tay`)
  const j = txt.indexOf(CLOSE, i)
  const json = txt.slice(i + OPEN.length, j).trim()
  return JSON.parse(json)
}

function renderTable(state) {
  const head = '| stage | status | attempts | gate | human |\n|---|---|---|---|---|'
  const rows = Object.entries(state.stages).map(
    ([id, s]) =>
      `| ${id} | ${s.status ?? 'pending'} | ${s.attempts ?? 0} | ${s.gate ?? '-'} | ${s.human ?? '-'} |`,
  )
  return [head, ...rows].join('\n')
}

export function writeState(featureDir, state) {
  const body = `<!-- GENERATED BY pp — DO NOT EDIT (PreToolUse hook chặn agent ghi file này) -->
# STATE — ${state.feature ?? ''}

current: **${state.current ?? '(hoàn tất)'}** · updated: ${state.updated ?? new Date().toISOString()}

${renderTable(state)}

${OPEN}
${JSON.stringify({ ...state, updated: state.updated ?? new Date().toISOString() }, null, 2)}
${CLOSE}
`
  writeFileSync(join(featureDir, FILE), body)
}

export function hashInputs(featureDir, inputs) {
  const h = createHash('sha256')
  for (const inp of inputs) {
    const p = join(featureDir, inp.path)
    if (!existsSync(p)) {
      if (inp.optional) continue
      throw new Error(`input bắt buộc không tồn tại: ${inp.path}`)
    }
    h.update(inp.path).update('\0').update(readFileSync(p))
  }
  return h.digest('hex').slice(0, 6)
}

export function isStale(featureDir, config, state, stageId) {
  const st = state.stages?.[stageId]
  if (!st || st.status !== 'done' || !st.inputs_hash) return false
  return hashInputs(featureDir, config.stages[stageId].inputs) !== st.inputs_hash
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `node --test tests/state.test.js`
Expected: PASS — 7 test xanh.

- [ ] **Step 5: Commit**

```bash
git add lib/state.js tests/state.test.js
git commit -m "feat(pp): STATE.md đọc/ghi, băm input, phát hiện stale"
```

---

## Task 4: `nextStage` — bộ não tất định

**Files:**
- Create: `lib/plan.js`
- Test: `tests/plan.test.js`

**Interfaces:**
- Consumes: `stageOrder` từ `lib/config.js`, `isStale` từ `lib/state.js`
- Produces: `nextStage(featureDir, config, state): Decision`
  - `Decision = { stage: string|null, action: Action, reason: string }`
  - `Action = 'run' | 'retry' | 'regate' | 'await-human' | 'blocked' | 'complete'`

Thứ tự ưu tiên trong một stage: `blocked` → `stale` → chờ người → `failed` (retry) → chưa chạy (`run`).

- [ ] **Step 1: Viết test thất bại**

```js
// tests/plan.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nextStage } from '../lib/plan.js'
import { hashInputs } from '../lib/state.js'

function setup() {
  const d = mkdtempSync(join(tmpdir(), 'pp-plan-'))
  writeFileSync(join(d, '00-brief.md'), 'brief\n')
  writeFileSync(join(d, '10-prd.md'), 'prd\n')
  const config = {
    stages: {
      '10-prd': { id: '10-prd', enabled: true, human: true, inputs: [{ path: '00-brief.md', optional: false }] },
      '20-ux': { id: '20-ux', enabled: false, human: false, inputs: [] },
      '40-testplan': { id: '40-testplan', enabled: true, human: false, inputs: [{ path: '10-prd.md', optional: false }] },
    },
  }
  return { d, config }
}

test('state rỗng thì chạy stage bật đầu tiên', () => {
  const { d, config } = setup()
  const r = nextStage(d, config, { stages: {} })
  assert.equal(r.stage, '10-prd')
  assert.equal(r.action, 'run')
})

test('bỏ qua stage đã tắt', () => {
  const { d, config } = setup()
  const state = { stages: { '10-prd': { status: 'done', human: 'approved', inputs_hash: hashInputs(d, config.stages['10-prd'].inputs) } } }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, '40-testplan')
})

test('stage cần người duyệt mà gate đã xanh thì chờ người', () => {
  const { d, config } = setup()
  const state = { stages: { '10-prd': { status: 'done', gate: 'pass', inputs_hash: hashInputs(d, config.stages['10-prd'].inputs) } } }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, '10-prd')
  assert.equal(r.action, 'await-human')
})

test('status failed thì retry đúng stage đó', () => {
  const { d, config } = setup()
  const state = { stages: { '10-prd': { status: 'failed', attempts: 1 } } }
  const r = nextStage(d, config, state)
  assert.equal(r.action, 'retry')
  assert.match(r.reason, /1\/3/)
})

test('status blocked thì dừng, không nhảy sang stage sau', () => {
  const { d, config } = setup()
  const state = { stages: { '10-prd': { status: 'blocked', attempts: 3 } } }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, '10-prd')
  assert.equal(r.action, 'blocked')
})

test('input thượng nguồn đổi thì stage hạ nguồn phải regate', () => {
  const { d, config } = setup()
  const state = {
    stages: {
      '10-prd': { status: 'done', human: 'approved', inputs_hash: hashInputs(d, config.stages['10-prd'].inputs) },
      '40-testplan': { status: 'done', inputs_hash: 'cu-roi' },
    },
  }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, '40-testplan')
  assert.equal(r.action, 'regate')
})

test('mọi stage xong thì complete', () => {
  const { d, config } = setup()
  const state = {
    stages: {
      '10-prd': { status: 'done', human: 'approved', inputs_hash: hashInputs(d, config.stages['10-prd'].inputs) },
      '40-testplan': { status: 'done', inputs_hash: hashInputs(d, config.stages['40-testplan'].inputs) },
    },
  }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, null)
  assert.equal(r.action, 'complete')
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `node --test tests/plan.test.js`
Expected: FAIL — `lib/plan.js` chưa tồn tại.

- [ ] **Step 3: Viết implementation tối thiểu**

```js
// lib/plan.js
import { stageOrder } from './config.js'
import { isStale } from './state.js'

export const MAX_ATTEMPTS = 3

export function nextStage(featureDir, config, state) {
  for (const id of stageOrder(config)) {
    const stage = config.stages[id]
    if (!stage.enabled) continue
    const st = state.stages?.[id] ?? { status: 'pending', attempts: 0 }

    if (st.status === 'blocked') {
      return { stage: id, action: 'blocked', reason: `đã thử ${st.attempts}/${MAX_ATTEMPTS} lần, cần người gỡ (pp unblock ${id})` }
    }
    if (st.status === 'done') {
      if (isStale(featureDir, config, state, id)) {
        return { stage: id, action: 'regate', reason: 'input thượng nguồn đã đổi — phải chạy lại gate' }
      }
      if (stage.human && st.human !== 'approved') {
        return { stage: id, action: 'await-human', reason: `gate xanh, chờ duyệt: pp approve ${id}` }
      }
      continue
    }
    if (st.status === 'failed') {
      return { stage: id, action: 'retry', reason: `gate đỏ, lần thử ${st.attempts ?? 0}/${MAX_ATTEMPTS}` }
    }
    return { stage: id, action: 'run', reason: 'chưa chạy' }
  }
  return { stage: null, action: 'complete', reason: 'mọi stage đã bật đều done và được duyệt' }
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `node --test tests/plan.test.js`
Expected: PASS — 7 test xanh.

- [ ] **Step 5: Commit**

```bash
git add lib/plan.js tests/plan.test.js
git commit -m "feat(pp): nextStage tất định với stale, human gate, capped retry"
```

---

## Task 5: Evidence — hoàn thành là dữ kiện

**Files:**
- Create: `lib/evidence.js`
- Test: `tests/evidence.test.js`

**Interfaces:**
- Consumes: —
- Produces:
  - `newEvidence(featureDir, stageId, tier, attempt): Evidence`
  - `Evidence` có method: `record(command: string, output: string, exitStatus: number): void`, `finish(result: 'PASS'|'FAIL'): string` (trả đường dẫn tương đối), `failed: boolean`
  - `hasFailure(featureDir, stageId): boolean` — quét file log, `true` nếu có bất kỳ `Exit status:` khác 0

- [ ] **Step 1: Viết test thất bại**

```js
// tests/evidence.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newEvidence, hasFailure } from '../lib/evidence.js'

test('ghi lệnh, output và exit status theo đúng định dạng', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  const ev = newEvidence(d, '40-testplan', 't1', 1)
  ev.record('pp-check placeholders 40-testplan.md', '', 0)
  ev.record('pp-check traceability', 'missing: AC-3-2', 1)
  const rel = ev.finish('FAIL')
  assert.equal(rel, '.evidence/40-testplan.log')
  const txt = readFileSync(join(d, rel), 'utf8')
  assert.match(txt, /\$ pp-check placeholders/)
  assert.match(txt, /Exit status: 0/)
  assert.match(txt, /missing: AC-3-2/)
  assert.match(txt, /Exit status: 1/)
  assert.match(txt, /RESULT: FAIL \(t1\) — attempt 1\/3/)
})

test('failed = true ngay khi có một exit khác 0', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  const ev = newEvidence(d, '10-prd', 't1', 1)
  ev.record('a', '', 0)
  assert.equal(ev.failed, false)
  ev.record('b', '', 2)
  assert.equal(ev.failed, true)
})

test('hasFailure đọc lại từ đĩa, không tin bộ nhớ', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  const ev = newEvidence(d, '10-prd', 't1', 1)
  ev.record('a', '', 0)
  ev.finish('PASS')
  assert.equal(hasFailure(d, '10-prd'), false)

  const ev2 = newEvidence(d, '10-prd', 't1', 2)
  ev2.record('b', 'hỏng', 1)
  ev2.finish('FAIL')
  assert.equal(hasFailure(d, '10-prd'), true)
})

test('không có evidence file thì coi như thất bại', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  assert.equal(hasFailure(d, '10-prd'), true)
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `node --test tests/evidence.test.js`
Expected: FAIL — `lib/evidence.js` chưa tồn tại.

- [ ] **Step 3: Viết implementation tối thiểu**

```js
// lib/evidence.js
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_ATTEMPTS } from './plan.js'

const DIR = '.evidence'

export function evidencePath(stageId) {
  return `${DIR}/${stageId}.log`
}

export function newEvidence(featureDir, stageId, tier, attempt) {
  mkdirSync(join(featureDir, DIR), { recursive: true })
  const lines = [`[${new Date().toISOString()}]  pp gate ${stageId} --tier ${tier}`]
  const ev = {
    failed: false,
    record(command, output, exitStatus) {
      lines.push(`$ ${command}`)
      if (output && output.trim()) {
        lines.push(...output.trimEnd().split('\n').map((l) => `  ${l}`))
      }
      lines.push(`Exit status: ${exitStatus}`)
      if (exitStatus !== 0) ev.failed = true
    },
    finish(result) {
      lines.push(`RESULT: ${result} (${tier}) — attempt ${attempt}/${MAX_ATTEMPTS}`, '')
      writeFileSync(join(featureDir, evidencePath(stageId)), lines.join('\n'))
      return evidencePath(stageId)
    },
  }
  return ev
}

export function hasFailure(featureDir, stageId) {
  const p = join(featureDir, evidencePath(stageId))
  if (!existsSync(p)) return true
  return readFileSync(p, 'utf8')
    .split('\n')
    .some((l) => /^Exit status: (?!0$)\d+$/.test(l.trim()))
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `node --test tests/evidence.test.js`
Expected: PASS — 4 test xanh.

- [ ] **Step 5: Commit**

```bash
git add lib/evidence.js tests/evidence.test.js
git commit -m "feat(pp): evidence file — done là dữ kiện đọc từ exit status"
```

---

## Task 6: Check dùng chung + gate runner

**Files:**
- Create: `lib/checks/common.js`
- Create: `lib/gate.js`
- Create: `schema/10-prd.json`
- Test: `tests/checks-common.test.js`, `tests/gate.test.js`

**Interfaces:**
- Consumes: `newEvidence` từ `lib/evidence.js`, `readConfig` từ `lib/config.js`, `readState`/`writeState`/`hashInputs` từ `lib/state.js`
- Produces:
  - `CheckResult = { name: string, ok: boolean, messages: string[] }`
  - `checkPlaceholders(text, file): CheckResult`
  - `checkHeadings(text, requiredHeadings, file): CheckResult`
  - `checkCitedPaths(text, repoRoot, file): CheckResult` — mọi đường dẫn trong backtick trông giống path (có `/` và phần mở rộng) phải tồn tại
  - `runT1(featureDir, config, state, stageId, checks): {ok, evidencePath}` trong `lib/gate.js`

- [ ] **Step 1: Viết test thất bại**

```js
// tests/checks-common.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPlaceholders, checkHeadings, checkCitedPaths } from '../lib/checks/common.js'

test('bắt mọi biến thể placeholder', () => {
  const r = checkPlaceholders('phần này TBD\ncòn đây TODO\nvà {{tên}}', 'x.md')
  assert.equal(r.ok, false)
  assert.equal(r.messages.length, 3)
  assert.match(r.messages[0], /dòng 1/)
})

test('văn bản sạch thì pass', () => {
  assert.equal(checkPlaceholders('nội dung đầy đủ', 'x.md').ok, true)
})

test('thiếu heading bắt buộc thì nêu đúng tên thiếu', () => {
  const r = checkHeadings('## User stories\n', ['## User stories', '## Out of scope'], 'x.md')
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /## Out of scope/)
})

test('đường dẫn cite không tồn tại thì fail', () => {
  const r = checkCitedPaths('xem `src/khong/co/that.ts`', process.cwd(), 'x.md')
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /src\/khong\/co\/that\.ts/)
})

test('backtick không phải path thì bỏ qua', () => {
  assert.equal(checkCitedPaths('chạy `yarn build` rồi `pp status`', process.cwd(), 'x.md').ok, true)
})
```

```js
// tests/gate.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, cpSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig } from '../lib/config.js'
import { readState } from '../lib/state.js'
import { runT1 } from '../lib/gate.js'

function feature(prdText) {
  const d = mkdtempSync(join(tmpdir(), 'pp-gate-'))
  cpSync(new URL('./fixtures/minimal/pipeline.json', import.meta.url).pathname, join(d, 'pipeline.json'))
  writeFileSync(join(d, '00-brief.md'), 'brief\n')
  writeFileSync(join(d, '10-prd.md'), prdText)
  return d
}

test('gate đỏ thì state = failed, attempts tăng, evidence có exit khác 0', () => {
  const d = feature('## User stories\nnội dung TBD\n')
  const r = runT1(d, readConfig(d), readState(d), '10-prd', [
    { name: 'placeholders', run: (t) => ({ name: 'placeholders', ok: !t.includes('TBD'), messages: ['có TBD'] }) },
  ])
  assert.equal(r.ok, false)
  const s = readState(d)
  assert.equal(s.stages['10-prd'].status, 'failed')
  assert.equal(s.stages['10-prd'].attempts, 1)
  assert.match(readFileSync(join(d, '.evidence/10-prd.log'), 'utf8'), /Exit status: 1/)
})

test('gate xanh thì state = done và lưu inputs_hash', () => {
  const d = feature('## User stories\nnội dung đầy đủ\n')
  const r = runT1(d, readConfig(d), readState(d), '10-prd', [
    { name: 'placeholders', run: () => ({ name: 'placeholders', ok: true, messages: [] }) },
  ])
  assert.equal(r.ok, true)
  const s = readState(d)
  assert.equal(s.stages['10-prd'].status, 'done')
  assert.equal(typeof s.stages['10-prd'].inputs_hash, 'string')
})

test('đỏ lần thứ 3 thì chuyển blocked', () => {
  const d = feature('TBD\n')
  const failing = [{ name: 'x', run: () => ({ name: 'x', ok: false, messages: ['hỏng'] }) }]
  for (let i = 0; i < 3; i++) runT1(d, readConfig(d), readState(d), '10-prd', failing)
  assert.equal(readState(d).stages['10-prd'].status, 'blocked')
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `node --test tests/checks-common.test.js tests/gate.test.js`
Expected: FAIL — `lib/checks/common.js` và `lib/gate.js` chưa tồn tại.

- [ ] **Step 3: Viết implementation tối thiểu**

```js
// lib/checks/common.js
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PLACEHOLDER = /\bTBD\b|\bTODO\b|\bFIXME\b|\bXXX\b|\?\?\?|\{\{[^}]*\}\}/

export function checkPlaceholders(text, file) {
  const messages = []
  text.split('\n').forEach((line, i) => {
    const m = line.match(PLACEHOLDER)
    if (m) messages.push(`${file} dòng ${i + 1}: còn placeholder "${m[0]}"`)
  })
  return { name: 'placeholders', ok: messages.length === 0, messages }
}

export function checkHeadings(text, required, file) {
  const messages = required
    .filter((h) => !text.includes(h))
    .map((h) => `${file}: thiếu heading bắt buộc "${h}"`)
  return { name: 'headings', ok: messages.length === 0, messages }
}

const LOOKS_LIKE_PATH = /^[\w./@-]+\/[\w./@-]+\.[a-z]{1,5}$/i

export function checkCitedPaths(text, repoRoot, file) {
  const messages = []
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const candidate = m[1].trim()
    if (!LOOKS_LIKE_PATH.test(candidate)) continue
    if (!existsSync(join(repoRoot, candidate))) {
      messages.push(`${file}: cite đường dẫn không tồn tại "${candidate}"`)
    }
  }
  return { name: 'cited-paths', ok: messages.length === 0, messages }
}
```

```js
// lib/gate.js
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { newEvidence } from './evidence.js'
import { readState, writeState, hashInputs } from './state.js'
import { MAX_ATTEMPTS } from './plan.js'

export function runT1(featureDir, config, state, stageId, checks) {
  const stage = config.stages[stageId]
  const prev = state.stages?.[stageId] ?? { attempts: 0 }
  const attempt = (prev.attempts ?? 0) + 1
  const ev = newEvidence(featureDir, stageId, 't1', attempt)

  const primaryOutput = stage.outputs[stage.outputs.length - 1]
  const text = readFileSync(join(featureDir, primaryOutput), 'utf8')

  for (const check of checks) {
    const res = check.run(text, { featureDir, stage, config })
    ev.record(`pp-check ${res.name} ${primaryOutput}`, res.ok ? '' : res.messages.join('\n'), res.ok ? 0 : 1)
  }

  const ok = !ev.failed
  const evidence = ev.finish(ok ? 'PASS' : 'FAIL')

  const next = readState(featureDir)
  next.feature = config.feature
  next.stages = next.stages ?? {}
  next.stages[stageId] = {
    ...prev,
    status: ok ? 'done' : attempt >= MAX_ATTEMPTS ? 'blocked' : 'failed',
    attempts: attempt,
    gate: ok ? 'pass' : 'fail',
    evidence,
    ...(ok ? { inputs_hash: hashInputs(featureDir, stage.inputs) } : {}),
  }
  writeState(featureDir, next)
  return { ok, evidencePath: evidence }
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `node --test tests/checks-common.test.js tests/gate.test.js`
Expected: PASS — 8 test xanh.

- [ ] **Step 5: Commit**

```bash
git add lib/checks/common.js lib/gate.js tests/checks-common.test.js tests/gate.test.js
git commit -m "feat(pp): check dùng chung và gate runner ghi state theo evidence"
```

---

## Task 7: Lệnh `pp init` và `pp status`

**Files:**
- Create: `lib/commands/init.js`
- Create: `lib/commands/status.js`
- Modify: `bin/pp` (đăng ký vào `COMMANDS`)
- Create: `templates/pipeline.S.json`, `templates/pipeline.M.json`
- Test: `tests/cmd-init-status.test.js`

**Interfaces:**
- Consumes: `readConfig`, `readState`, `nextStage`
- Produces:
  - `pp init <feature> [--size S|M|L] [--root DIR]` → tạo `features/<feature>/` với `pipeline.json`, `00-brief.md`, `STATE.md`. Exit 0; exit 1 nếu đã tồn tại.
  - `pp status <feature> [--root DIR]` → in stage kế tiếp + lý do. Exit 0 bình thường, exit 3 khi `blocked`.
  - Cả hai lệnh nhận `--root` để test trỏ vào thư mục tạm; mặc định là gốc repo (thư mục chứa `constitution.md`).

- [ ] **Step 1: Viết test thất bại**

```js
// tests/cmd-init-status.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const PP = new URL('../bin/pp', import.meta.url).pathname

function run(args, opts = {}) {
  try {
    return { code: 0, out: execFileSync('node', [PP, ...args], { encoding: 'utf8', ...opts }) }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}

function tmpRoot() {
  const d = mkdtempSync(join(tmpdir(), 'pp-root-'))
  writeFileSync(join(d, 'constitution.md'), '# Constitution\n')
  return d
}

test('init tạo đủ file', () => {
  const root = tmpRoot()
  const r = run(['init', 'demo', '--size', 'S', '--root', root])
  assert.equal(r.code, 0)
  for (const f of ['pipeline.json', '00-brief.md', 'STATE.md']) {
    assert.ok(existsSync(join(root, 'features/demo', f)), `thiếu ${f}`)
  }
})

test('init lần hai thì từ chối, exit 1', () => {
  const root = tmpRoot()
  run(['init', 'demo', '--root', root])
  const r = run(['init', 'demo', '--root', root])
  assert.equal(r.code, 1)
  assert.match(r.out, /đã tồn tại/)
})

test('status ngay sau init trỏ vào stage đầu tiên', () => {
  const root = tmpRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  const r = run(['status', 'demo', '--root', root])
  assert.equal(r.code, 0)
  assert.match(r.out, /10-prd/)
  assert.match(r.out, /run/)
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `node --test tests/cmd-init-status.test.js`
Expected: FAIL — `pp: không biết lệnh "init"`, exit 2 thay vì 0.

- [ ] **Step 3: Viết implementation tối thiểu**

```json
// templates/pipeline.S.json
{
  "feature": "__FEATURE__",
  "size": "S",
  "stages": {
    "10-prd": {
      "enabled": true,
      "skills": ["prd-epic", "userstory", "ac"],
      "inputs": ["00-brief.md", "../../constitution.md"],
      "outputs": ["10-questions.md", "10-prd.md"],
      "gate": ["t1", "t2"],
      "human": true
    },
    "40-testplan": {
      "enabled": true,
      "skills": ["test-cases", "test-checklist"],
      "inputs": ["10-prd.md", "30-contract.md?"],
      "outputs": ["40-testplan.md"],
      "gate": ["t1", "t2"],
      "human": false
    }
  }
}
```

`templates/pipeline.M.json` giống hệt, thêm `"20-ux"` với `"enabled": false` và `"size": "M"`.

```js
// lib/commands/init.js
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeState } from '../state.js'

export function initCmd(args, { root }) {
  const feature = args.find((a) => !a.startsWith('--'))
  if (!feature) { process.stdout.write('pp init <feature> [--size S|M|L]\n'); return 2 }
  const sizeIdx = args.indexOf('--size')
  const size = sizeIdx === -1 ? 'M' : args[sizeIdx + 1]

  const dir = join(root, 'features', feature)
  if (existsSync(dir)) { process.stdout.write(`pp: features/${feature} đã tồn tại\n`); return 1 }

  const tplPath = join(root, 'templates', `pipeline.${size}.json`)
  const tpl = readFileSync(existsSync(tplPath) ? tplPath : join(root, 'templates', 'pipeline.M.json'), 'utf8')

  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pipeline.json'), tpl.replaceAll('__FEATURE__', feature))
  writeFileSync(join(dir, '00-brief.md'), `# Brief — ${feature}

Viết 3–10 dòng dạng DELTA so với hiện trạng: hôm nay hệ thống làm gì,
sau thay đổi này nó làm khác đi ở đâu, và vì sao cần.
`)
  writeState(dir, { feature, current: null, stages: {} })
  process.stdout.write(`đã tạo features/${feature} (size ${size})\nbước tiếp: viết 00-brief.md rồi chạy  pp status ${feature}\n`)
  return 0
}
```

```js
// lib/commands/status.js
import { join } from 'node:path'
import { readConfig } from '../config.js'
import { readState } from '../state.js'
import { nextStage } from '../plan.js'

export function statusCmd(args, { root }) {
  const feature = args.find((a) => !a.startsWith('--'))
  if (!feature) { process.stdout.write('pp status <feature>\n'); return 2 }
  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  const state = readState(dir)
  const d = nextStage(dir, config, state)

  if (d.action === 'complete') { process.stdout.write(`✓ ${feature}: mọi stage đã xong\n`); return 0 }
  process.stdout.write(`${feature}\n  stage kế tiếp : ${d.stage}\n  hành động     : ${d.action}\n  lý do         : ${d.reason}\n`)
  return d.action === 'blocked' ? 3 : 0
}
```

Sửa `bin/pp` — thay khối `COMMANDS` và `USAGE`:

```js
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { initCmd } from '../lib/commands/init.js'
import { statusCmd } from '../lib/commands/status.js'

const COMMANDS = { init: initCmd, status: statusCmd }

const USAGE = `Usage: pp <command> [options]

Commands:
  init <feature> [--size S|M|L]   Tạo blackboard cho feature mới
  status <feature>                In stage kế tiếp và lý do

Options:
  --root DIR   Gốc repo pinnacle-product (mặc định: tự dò lên từ cwd)
  --help
`

function findRoot(args) {
  const i = args.indexOf('--root')
  if (i !== -1) return resolve(args[i + 1])
  let dir = process.cwd()
  while (dir !== '/') {
    if (existsSync(join(dir, 'constitution.md'))) return dir
    dir = resolve(dir, '..')
  }
  throw new Error('không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)')
}
```

Và trong `main`, đổi lời gọi handler thành `return await handler(rest, { root: findRoot(rest) })`. Lưu ý `bin/pp` dùng `import.meta` nên đường dẫn import là `../lib/...` tính từ `bin/`.

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `node --test tests/cmd-init-status.test.js`
Expected: PASS — 3 test xanh.

- [ ] **Step 5: Chạy toàn bộ test rồi commit**

```bash
node --test tests/
git add bin/pp lib/commands/ templates/ tests/cmd-init-status.test.js
git commit -m "feat(pp): lệnh init và status"
```

---

## Task 8: BOOTSTRAP — thu output thật của `dev-ba-kit` làm fixture

> **Task này có người tham gia.** Không phải task TDD — sản phẩm của nó là **dữ liệu thật**, không phải code. Nó tồn tại vì rủi ro lớn nhất của cả thiết kế: schema và rubric ở Task 9–10 đang dựa trên *giả định* về định dạng output của `dev-ba-kit`, chưa ai nhìn thấy output thật. Làm Task 9 trước Task 8 là viết regex cho một định dạng tưởng tượng.

**Files:**
- Create: `tests/fixtures/real/10-prd.md` (output thật, chưa sửa)
- Create: `tests/fixtures/real/40-testplan.md` (output thật, chưa sửa)
- Create: `tests/fixtures/real/NOTES.md` (quan sát về định dạng)

**Interfaces:**
- Consumes: `dev-ba-kit` skill `/prd-epic`, `/userstory`, `/ac`, `/test-cases`
- Produces: hai file fixture + `NOTES.md` trả lời 5 câu ở Step 4. Task 9 và 10 viết regex **bám vào hai file này**, không bám vào giả định.

- [ ] **Step 1: Chọn feature mồi**

Chọn một feature **thật nhưng nhỏ** từ `pinnacle-backend`/`pinnacle-web` mà bạn đã biết đáp án — loại đã làm xong hoặc hiểu rõ. Không chọn feature mới. Mục đích là so được output của agent với sự thật bạn đã biết.

Ghi tên feature và một brief 3–10 dòng vào `tests/fixtures/real/NOTES.md` mục "Feature mồi".

- [ ] **Step 2: Chạy `/prd-epic` → `/userstory` → `/ac` bằng tay**

Chạy trong một session Claude Code bình thường, **không qua `pp`, không gate**. Lưu output nguyên trạng — không sửa, không làm đẹp:

```bash
# lưu output vào đây, giữ nguyên định dạng gốc
tests/fixtures/real/10-prd.md
```

- [ ] **Step 3: Chạy `/test-cases` bằng tay**

```bash
tests/fixtures/real/40-testplan.md
```

- [ ] **Step 4: Ghi quan sát định dạng vào `NOTES.md`**

Trả lời đúng 5 câu — Task 9 và 10 phụ thuộc trực tiếp vào đây:

1. User story có ID không? Định dạng thật là gì (`US-1`, `US1`, `#1`, hay không có)?
2. AC có ID không? AC nằm dạng bullet, bảng, hay đoạn văn?
3. AC có viết theo EARS (`THE SYSTEM SHALL`) không, hay theo Given/When/Then, hay văn xuôi tự do?
4. Test case có ID và có trường liên kết ngược về AC không?
5. Heading cấp 2 (`##`) thật sự xuất hiện là những heading nào?

- [ ] **Step 5: Quyết định — regex trực tiếp hay cần `pp normalize`**

Ghi kết luận vào `NOTES.md`:

- **Nếu output đã có ID ổn định và cấu trúc rõ** → Task 9/10 viết regex bám thẳng vào định dạng đó. Không cần `normalize`.
- **Nếu output quá tự do để bắt được ID** → Task 9 phải bổ sung `lib/normalize.js` chèn thẻ XML (`<ac id="AC-1-1" story="US-1">…</ac>`) **sau khi** skill chạy xong. **Tuyệt đối không sửa `dev-ba-kit`** — lớp toolbox là bất khả xâm phạm (Nguyên tắc 4 của spec).

- [ ] **Step 6: Ghi lại những chỗ output sơ sài — đây là nguyên liệu cho rubric**

Đọc kỹ hai file, liệt kê vào `NOTES.md` mục "Chỗ sơ sài" **đúng những chỗ bạn thấy nông**: AC nào mơ hồ, edge case nào thiếu, giả định nào chưa nêu, câu nào đúng mà vô nghĩa. Mỗi mục một dòng.

Danh sách này trở thành tiêu chí trong `rubric/10-prd.md` và `rubric/40-testplan.md` ở Task 13. **Rubric sinh từ lỗi thật tốt hơn rubric bịa ra.**

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/real/
git commit -m "test(fixtures): output thật của dev-ba-kit cho feature mồi"
```

---

## Task 9: Check riêng cho `10-prd`

**Files:**
- Create: `lib/checks/prd.js`
- Create: `schema/10-prd.json`
- Test: `tests/checks-prd.test.js`

**Interfaces:**
- Consumes: `tests/fixtures/real/10-prd.md` và `NOTES.md` từ Task 8; `CheckResult` từ `lib/checks/common.js`
- Produces:
  - `checkEars(text, file): CheckResult` — mỗi AC khớp 1 trong 5 pattern EARS và chứa **đúng một** `SHALL`
  - `checkIds(text, file): CheckResult` — mọi AC thuộc về một US có thật; không có AC mồ côi
  - `checkRiskChecklist(text, file, requiredItems): CheckResult` — mọi mục rủi ro có kết luận khác rỗng
  - `checkQuestionsAnswered(featureDir): CheckResult` — `10-questions.md` có ≥8 câu và mọi câu có dòng `A:` khác rỗng
  - `prdChecks(schema): Check[]` — danh sách để `runT1` dùng

> **Điều chỉnh bắt buộc trước khi code:** đọc `tests/fixtures/real/NOTES.md`. Nếu Step 5 của Task 8 kết luận cần `pp normalize`, viết `lib/normalize.js` trước và cho `prdChecks` chạy trên bản đã normalize. Regex dưới đây giả định thẻ `<ac>` đã có mặt — **thay bằng định dạng thật nếu khác**.

- [ ] **Step 1: Viết test thất bại**

```js
// tests/checks-prd.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkEars, checkIds, checkRiskChecklist, checkQuestionsAnswered } from '../lib/checks/prd.js'

const OK_PRD = `## User stories
<us id="US-1">Là người dùng, tôi muốn gửi phản hồi</us>
<ac id="AC-1-1" story="US-1">
WHEN người dùng submit form hợp lệ THE SYSTEM SHALL lưu phản hồi và trả 201
</ac>
<ac id="AC-1-2" story="US-1">
IF form thiếu trường bắt buộc THE SYSTEM SHALL trả 400 kèm danh sách trường lỗi
</ac>

## Out of scope
- Không làm export CSV

## Rủi ro
- migrate dữ liệu cũ: không có dữ liệu cũ, feature mới hoàn toàn
- ai không được phép: người dùng chưa đăng nhập không gọi được endpoint
`

test('AC đúng EARS thì pass', () => {
  assert.equal(checkEars(OK_PRD, 'p.md').ok, true)
})

test('AC không có SHALL thì fail và nêu id', () => {
  const bad = OK_PRD.replace('THE SYSTEM SHALL lưu phản hồi và trả 201', 'thì lưu phản hồi')
  const r = checkEars(bad, 'p.md')
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /AC-1-1/)
})

test('AC có hai SHALL thì fail vì bị gộp', () => {
  const bad = OK_PRD.replace(
    'THE SYSTEM SHALL lưu phản hồi và trả 201',
    'THE SYSTEM SHALL lưu phản hồi và THE SYSTEM SHALL gửi email',
  )
  const r = checkEars(bad, 'p.md')
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /gộp|hai/i)
})

test('AC trỏ tới US không tồn tại thì fail', () => {
  const bad = OK_PRD.replace('story="US-1"', 'story="US-9"')
  const r = checkIds(bad, 'p.md')
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /US-9/)
})

test('mục rủi ro bỏ trống thì fail', () => {
  const bad = OK_PRD.replace('- ai không được phép: người dùng chưa đăng nhập không gọi được endpoint', '- ai không được phép:')
  const r = checkRiskChecklist(bad, 'p.md', ['migrate dữ liệu cũ', 'ai không được phép'])
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /ai không được phép/)
})

test('questions chưa trả lời hết thì fail', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  const qs = Array.from({ length: 8 }, (_, i) => `Q${i + 1}: câu hỏi ${i + 1}\nA: trả lời`).join('\n\n')
  writeFileSync(join(d, '10-questions.md'), qs.replace('A: trả lời', 'A:'))
  const r = checkQuestionsAnswered(d)
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /Q1/)
})

test('đủ 8 câu và trả lời hết thì pass', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  writeFileSync(join(d, '10-questions.md'), Array.from({ length: 8 }, (_, i) => `Q${i + 1}: hỏi\nA: đáp`).join('\n\n'))
  assert.equal(checkQuestionsAnswered(d).ok, true)
})

test('dưới 8 câu hỏi thì fail', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  writeFileSync(join(d, '10-questions.md'), 'Q1: hỏi\nA: đáp\n')
  const r = checkQuestionsAnswered(d)
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /8/)
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `node --test tests/checks-prd.test.js`
Expected: FAIL — `lib/checks/prd.js` chưa tồn tại.

- [ ] **Step 3: Viết implementation tối thiểu**

```json
// schema/10-prd.json
{
  "requiredHeadings": ["## User stories", "## Out of scope", "## Rủi ro"],
  "riskChecklist": [
    "migrate dữ liệu cũ",
    "ai không được phép",
    "thao tác đồng thời",
    "mạng lỗi hoặc offline",
    "giới hạn kích thước và phân trang",
    "i18n và timezone",
    "hiệu năng khi dữ liệu lớn",
    "rollback"
  ],
  "minQuestions": 8
}
```

```js
// lib/checks/prd.js
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const EARS = [
  /^THE SYSTEM SHALL .+$/s,
  /^WHEN .+ THE SYSTEM SHALL .+$/s,
  /^WHILE .+ THE SYSTEM SHALL .+$/s,
  /^IF .+ THE SYSTEM SHALL .+$/s,
  /^WHEN .+ WHILE .+ IF .+ THE SYSTEM SHALL .+$/s,
]

function acBlocks(text) {
  return [...text.matchAll(/<ac id="([^"]+)"(?:\s+story="([^"]+)")?\s*>([\s\S]*?)<\/ac>/g)].map(
    (m) => ({ id: m[1], story: m[2], body: m[3].trim() }),
  )
}

export function checkEars(text, file) {
  const messages = []
  for (const ac of acBlocks(text)) {
    const shalls = (ac.body.match(/THE SYSTEM SHALL/g) ?? []).length
    if (shalls === 0) {
      messages.push(`${file}: ${ac.id} không viết theo EARS — thiếu "THE SYSTEM SHALL"`)
    } else if (shalls > 1) {
      messages.push(`${file}: ${ac.id} có ${shalls} chữ SHALL — AC bị gộp, phải tách thành ${shalls} AC`)
    } else if (!EARS.some((re) => re.test(ac.body))) {
      messages.push(`${file}: ${ac.id} không khớp pattern EARS nào (WHEN / WHILE / IF / ubiquitous)`)
    }
  }
  if (acBlocks(text).length === 0) messages.push(`${file}: không tìm thấy AC nào`)
  return { name: 'ears', ok: messages.length === 0, messages }
}

export function checkIds(text, file) {
  const stories = new Set([...text.matchAll(/<us id="([^"]+)"/g)].map((m) => m[1]))
  const messages = []
  if (stories.size === 0) messages.push(`${file}: không tìm thấy user story nào`)
  for (const ac of acBlocks(text)) {
    if (!ac.story) messages.push(`${file}: ${ac.id} là AC mồ côi — thiếu thuộc tính story`)
    else if (!stories.has(ac.story)) messages.push(`${file}: ${ac.id} trỏ tới story không tồn tại "${ac.story}"`)
  }
  return { name: 'ids', ok: messages.length === 0, messages }
}

export function checkRiskChecklist(text, file, requiredItems) {
  const messages = []
  for (const item of requiredItems) {
    const re = new RegExp(`${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)`, 'i')
    const m = text.match(re)
    if (!m) messages.push(`${file}: thiếu mục rủi ro "${item}"`)
    else if (!m[1].trim()) messages.push(`${file}: mục rủi ro "${item}" bỏ trống — phải có kết luận, kể cả "không áp dụng vì …"`)
  }
  return { name: 'risk-checklist', ok: messages.length === 0, messages }
}

export function checkQuestionsAnswered(featureDir, minQuestions = 8) {
  const p = join(featureDir, '10-questions.md')
  if (!existsSync(p)) {
    return { name: 'questions', ok: false, messages: ['thiếu 10-questions.md — phải hỏi trước khi viết PRD'] }
  }
  const text = readFileSync(p, 'utf8')
  const pairs = [...text.matchAll(/^(Q\d+):[^\n]*\n+A:([^\n]*)/gm)]
  const messages = []
  if (pairs.length < minQuestions) {
    messages.push(`10-questions.md: mới có ${pairs.length} câu, cần tối thiểu ${minQuestions}`)
  }
  for (const m of pairs) {
    if (!m[2].trim()) messages.push(`10-questions.md: ${m[1]} chưa có câu trả lời`)
  }
  return { name: 'questions', ok: messages.length === 0, messages }
}

export function prdChecks(schema) {
  return [
    { name: 'ears', run: (t) => checkEars(t, '10-prd.md') },
    { name: 'ids', run: (t) => checkIds(t, '10-prd.md') },
    { name: 'risk-checklist', run: (t) => checkRiskChecklist(t, '10-prd.md', schema.riskChecklist) },
    { name: 'questions', run: (_t, ctx) => checkQuestionsAnswered(ctx.featureDir, schema.minQuestions) },
  ]
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `node --test tests/checks-prd.test.js`
Expected: PASS — 8 test xanh.

- [ ] **Step 5: Chạy check trên fixture thật và ghi lại kết quả**

```bash
node -e "
import('./lib/checks/prd.js').then(async (m) => {
  const { readFileSync } = await import('node:fs')
  const t = readFileSync('tests/fixtures/real/10-prd.md','utf8')
  for (const r of [m.checkEars(t,'real'), m.checkIds(t,'real')]) console.log(r.name, r.ok, r.messages)
})"
```

Kết quả **đỏ là bình thường** ở lần đầu — output thật của `dev-ba-kit` chưa viết EARS. Ghi kết quả vào `tests/fixtures/real/NOTES.md` mục "Kết quả gate lần đầu". Đây là số liệu nền để so ở Step 3 của §10.2 (chạy lại sau khi bật gate). **Không sửa fixture cho vừa regex** — fixture là sự thật.

- [ ] **Step 6: Commit**

```bash
git add lib/checks/prd.js schema/10-prd.json tests/checks-prd.test.js tests/fixtures/real/NOTES.md
git commit -m "feat(pp): check EARS, id, checklist rủi ro và questions cho 10-prd"
```

---

## Task 10: Check riêng cho `40-testplan`

**Files:**
- Create: `lib/checks/testplan.js`
- Create: `schema/40-testplan.json`
- Test: `tests/checks-testplan.test.js`

**Interfaces:**
- Consumes: `acBlocks` logic từ `lib/checks/prd.js` (export thêm `parseAcIds(text): string[]`)
- Produces:
  - `parseAcIds(text): string[]` (thêm export vào `lib/checks/prd.js`)
  - `checkTraceability(prdText, planText): CheckResult` — mọi AC id phải xuất hiện trong `ac_ref`
  - `checkTcSchema(planText): CheckResult` — mỗi TC đủ `id · ac_ref · type · priority` và thân có `precondition/steps/expected`
  - `checkTypeRatio(prdText, planText): CheckResult` — mỗi AC có ≥1 `positive` và ≥1 `negative`
  - `testplanChecks(featureDir, schema): Check[]`

- [ ] **Step 1: Viết test thất bại**

```js
// tests/checks-testplan.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkTraceability, checkTcSchema, checkTypeRatio } from '../lib/checks/testplan.js'

const PRD = `
<ac id="AC-1-1" story="US-1">WHEN a THE SYSTEM SHALL b</ac>
<ac id="AC-1-2" story="US-1">IF c THE SYSTEM SHALL d</ac>
`

const PLAN = `
<tc id="TC-001" ac_ref="AC-1-1" type="positive" priority="high">
precondition: đã đăng nhập
steps: submit form hợp lệ
expected: trả 201
</tc>
<tc id="TC-002" ac_ref="AC-1-1" type="negative" priority="high">
precondition: đã đăng nhập
steps: submit form thiếu trường
expected: trả 400
</tc>
`

test('AC không được phủ thì fail và liệt kê đúng id', () => {
  const r = checkTraceability(PRD, PLAN)
  assert.equal(r.ok, false)
  assert.match(r.messages.join(' '), /AC-1-2/)
  assert.doesNotMatch(r.messages.join(' '), /AC-1-1/)
})

test('phủ đủ thì pass', () => {
  const full = PLAN + `
<tc id="TC-003" ac_ref="AC-1-2" type="positive" priority="low">
precondition: -
steps: c xảy ra
expected: d
</tc>
<tc id="TC-004" ac_ref="AC-1-2" type="negative" priority="low">
precondition: -
steps: c không xảy ra
expected: không d
</tc>
`
  assert.equal(checkTraceability(PRD, full).ok, true)
})

test('TC thiếu field bắt buộc thì fail và nêu tên field', () => {
  const bad = PLAN.replace(' priority="high">', '>')
  const r = checkTcSchema(bad)
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /priority/)
})

test('TC thiếu expected trong thân thì fail', () => {
  const bad = PLAN.replace('expected: trả 201\n', '')
  const r = checkTcSchema(bad)
  assert.equal(r.ok, false)
  assert.match(r.messages.join(' '), /expected/)
})

test('AC chỉ có case thuận thì fail vì thiếu negative', () => {
  const onlyPositive = PLAN.replace('type="negative"', 'type="positive"')
  const r = checkTypeRatio(PRD, onlyPositive)
  assert.equal(r.ok, false)
  assert.match(r.messages.join(' '), /AC-1-1.*negative/s)
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `node --test tests/checks-testplan.test.js`
Expected: FAIL — `lib/checks/testplan.js` chưa tồn tại.

- [ ] **Step 3: Viết implementation tối thiểu**

Thêm export vào `lib/checks/prd.js`:

```js
export function parseAcIds(text) {
  return [...text.matchAll(/<ac id="([^"]+)"/g)].map((m) => m[1])
}
```

```json
// schema/40-testplan.json
{
  "requiredHeadings": ["## Test cases"],
  "requiredTcAttrs": ["id", "ac_ref", "type", "priority"],
  "requiredTcFields": ["precondition", "steps", "expected"],
  "edgeCaseChecklist": [
    "null", "rỗng", "vượt max length", "unicode hoặc emoji", "số âm",
    "0", "số rất lớn", "sai định dạng", "trùng lặp", "gọi đồng thời", "sai quyền"
  ]
}
```

```js
// lib/checks/testplan.js
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseAcIds } from './prd.js'

const DEFAULT_ATTRS = ['id', 'ac_ref', 'type', 'priority']
const DEFAULT_FIELDS = ['precondition', 'steps', 'expected']

function tcBlocks(text) {
  return [...text.matchAll(/<tc\s+([^>]*)>([\s\S]*?)<\/tc>/g)].map((m) => {
    const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]))
    return { attrs, body: m[2], raw: m[0] }
  })
}

export function checkTraceability(prdText, planText) {
  const acIds = parseAcIds(prdText)
  const covered = new Set(tcBlocks(planText).map((tc) => tc.attrs.ac_ref).filter(Boolean))
  const missing = acIds.filter((id) => !covered.has(id))
  const messages = missing.length
    ? [`${missing.length}/${acIds.length} AC chưa có test case: ${missing.join(', ')}`]
    : []
  return { name: 'traceability', ok: messages.length === 0, messages }
}

export function checkTcSchema(planText, attrs = DEFAULT_ATTRS, fields = DEFAULT_FIELDS) {
  const messages = []
  const blocks = tcBlocks(planText)
  if (blocks.length === 0) messages.push('không tìm thấy test case nào')
  blocks.forEach((tc, i) => {
    const label = tc.attrs.id ?? `TC #${i + 1}`
    for (const a of attrs) if (!tc.attrs[a]) messages.push(`${label}: thiếu thuộc tính "${a}"`)
    for (const f of fields) {
      const m = tc.body.match(new RegExp(`^\\s*${f}\\s*:(.*)$`, 'm'))
      if (!m) messages.push(`${label}: thiếu trường "${f}"`)
      else if (!m[1].trim()) messages.push(`${label}: trường "${f}" bỏ trống`)
    }
  })
  return { name: 'tc-schema', ok: messages.length === 0, messages }
}

export function checkTypeRatio(prdText, planText) {
  const byAc = new Map()
  for (const tc of tcBlocks(planText)) {
    if (!tc.attrs.ac_ref) continue
    if (!byAc.has(tc.attrs.ac_ref)) byAc.set(tc.attrs.ac_ref, new Set())
    byAc.get(tc.attrs.ac_ref).add(tc.attrs.type)
  }
  const messages = []
  for (const id of parseAcIds(prdText)) {
    const types = byAc.get(id) ?? new Set()
    for (const need of ['positive', 'negative']) {
      if (!types.has(need)) messages.push(`${id}: thiếu case "${need}"`)
    }
  }
  return { name: 'type-ratio', ok: messages.length === 0, messages }
}

export function testplanChecks(featureDir, schema) {
  const prdPath = join(featureDir, '10-prd.md')
  const prd = existsSync(prdPath) ? readFileSync(prdPath, 'utf8') : ''
  return [
    { name: 'traceability', run: (t) => checkTraceability(prd, t) },
    { name: 'tc-schema', run: (t) => checkTcSchema(t, schema.requiredTcAttrs, schema.requiredTcFields) },
    { name: 'type-ratio', run: (t) => checkTypeRatio(prd, t) },
  ]
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `node --test tests/checks-testplan.test.js`
Expected: PASS — 5 test xanh.

- [ ] **Step 5: Commit**

```bash
git add lib/checks/testplan.js lib/checks/prd.js schema/40-testplan.json tests/checks-testplan.test.js
git commit -m "feat(pp): check traceability, schema TC và tỉ lệ loại test cho 40-testplan"
```

---

## Task 11: Lệnh `pp gate` và `pp advance`

**Files:**
- Create: `lib/commands/gate.js`
- Create: `lib/commands/advance.js`
- Create: `lib/registry.js`
- Modify: `bin/pp`
- Create: `commands/pp.md`
- Test: `tests/cmd-gate.test.js`

**Interfaces:**
- Consumes: `runT1` từ `lib/gate.js`, `prdChecks` từ `lib/checks/prd.js`, `testplanChecks` từ `lib/checks/testplan.js`, `nextStage` từ `lib/plan.js`
- Produces:
  - `checksFor(stageId, featureDir, root): Check[]` trong `lib/registry.js` — nối stage id với bộ check + schema; stage lạ trả về chỉ check dùng chung
  - `pp gate <feature> <stage> [--tier t1]` → exit 0 xanh, exit 1 đỏ, in danh sách lỗi
  - `pp advance <feature>` → in **chỉ thị** cho Claude: stage nào, đọc file nào (`inputs`), gọi skill nào, ghi file nào. **`pp` không tự gọi LLM** — nó in chỉ thị, Claude đọc rồi thực hiện.

- [ ] **Step 1: Viết test thất bại**

```js
// tests/cmd-gate.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const PP = new URL('../bin/pp', import.meta.url).pathname
const REPO = new URL('../', import.meta.url).pathname

function run(args) {
  try { return { code: 0, out: execFileSync('node', [PP, ...args], { encoding: 'utf8' }) } }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') } }
}

function root() {
  const d = mkdtempSync(join(tmpdir(), 'pp-g-'))
  writeFileSync(join(d, 'constitution.md'), '# c\n')
  mkdirSync(join(d, 'schema'), { recursive: true })
  cpSync(join(REPO, 'schema'), join(d, 'schema'), { recursive: true })
  cpSync(join(REPO, 'templates'), join(d, 'templates'), { recursive: true })
  return d
}

test('gate đỏ in đúng AC còn thiếu và exit 1', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const f = join(r0, 'features/demo')
  writeFileSync(join(f, '10-prd.md'), '<ac id="AC-1-1" story="US-1">WHEN a THE SYSTEM SHALL b</ac>\n')
  writeFileSync(join(f, '40-testplan.md'), '## Test cases\n')
  const r = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /AC-1-1/)
})

test('advance in chỉ thị gồm inputs, skills và outputs', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /10-prd/)
  assert.match(r.out, /00-brief\.md/)
  assert.match(r.out, /prd-epic/)
  assert.match(r.out, /10-prd\.md/)
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `node --test tests/cmd-gate.test.js`
Expected: FAIL — `pp: không biết lệnh "gate"`.

- [ ] **Step 3: Viết implementation tối thiểu**

```js
// lib/registry.js
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkPlaceholders, checkHeadings, checkCitedPaths } from './checks/common.js'
import { prdChecks } from './checks/prd.js'
import { testplanChecks } from './checks/testplan.js'

function loadSchema(root, stageId) {
  const p = join(root, 'schema', `${stageId}.json`)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
}

export function checksFor(stageId, featureDir, root) {
  const schema = loadSchema(root, stageId)
  const common = [
    { name: 'placeholders', run: (t) => checkPlaceholders(t, `${stageId}.md`) },
    { name: 'headings', run: (t) => checkHeadings(t, schema.requiredHeadings ?? [], `${stageId}.md`) },
    { name: 'cited-paths', run: (t) => checkCitedPaths(t, join(root, '..'), `${stageId}.md`) },
  ]
  if (stageId === '10-prd') return [...common, ...prdChecks(schema)]
  if (stageId === '40-testplan') return [...common, ...testplanChecks(featureDir, schema)]
  return common
}
```

```js
// lib/commands/gate.js
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { readConfig } from '../config.js'
import { readState } from '../state.js'
import { runT1 } from '../gate.js'
import { checksFor } from '../registry.js'

export function gateCmd(args, { root }) {
  const [feature, stageId] = args.filter((a) => !a.startsWith('--'))
  if (!feature || !stageId) { process.stdout.write('pp gate <feature> <stage> [--tier t1]\n'); return 2 }
  const dir = join(root, 'features', feature)
  const r = runT1(dir, readConfig(dir), readState(dir), stageId, checksFor(stageId, dir, root))
  process.stdout.write(readFileSync(join(dir, r.evidencePath), 'utf8'))
  return r.ok ? 0 : 1
}
```

```js
// lib/commands/advance.js
import { join } from 'node:path'
import { readConfig } from '../config.js'
import { readState } from '../state.js'
import { nextStage } from '../plan.js'

export function advanceCmd(args, { root }) {
  const feature = args.find((a) => !a.startsWith('--'))
  if (!feature) { process.stdout.write('pp advance <feature>\n'); return 2 }
  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  const d = nextStage(dir, config, readState(dir))

  if (d.action === 'complete') { process.stdout.write(`✓ ${feature}: mọi stage đã xong\n`); return 0 }
  if (d.action === 'blocked') { process.stdout.write(`⛔ ${d.stage} blocked: ${d.reason}\n`); return 3 }
  if (d.action === 'await-human') { process.stdout.write(`🚦 ${d.stage}: ${d.reason}\n`); return 0 }

  const s = config.stages[d.stage]
  process.stdout.write(`CHỈ THỊ CHO STAGE ${d.stage}  (${d.action} — ${d.reason})

Chạy trong MỘT subagent mới. Chỉ đọc đúng các file dưới đây, không quét thư mục khác.

  Thư mục   : features/${feature}/
  Đọc       : ${s.inputs.map((i) => i.path + (i.optional ? ' (optional)' : '')).join(', ')}
  Gọi skill : ${s.skills.map((x) => '/' + x).join(' → ') || '(không có)'}
  Ghi       : ${s.outputs.join(', ')}
  Sau đó    : pp gate ${feature} ${d.stage}

Ràng buộc: mọi đường dẫn cite phải có thật; AC viết EARS, đúng một SHALL mỗi AC;
không để lại TBD/TODO. Không được ghi STATE.md hay .evidence/.
`)
  return 0
}
```

Đăng ký trong `bin/pp`: thêm `gate: gateCmd, advance: advanceCmd` vào `COMMANDS` và thêm hai dòng tương ứng vào `USAGE`.

```markdown
<!-- commands/pp.md — slash command /pp -->
---
description: Chạy conductor pipeline sản phẩm cho một feature
---

Chạy `pp advance <feature>` (hoặc lệnh người dùng đưa trong $ARGUMENTS), đọc chỉ thị in ra, rồi:

1. Nếu là `CHỈ THỊ CHO STAGE …` — mở một subagent mới, đưa nguyên chỉ thị đó làm prompt.
   Subagent chỉ được đọc các file trong dòng `Đọc`, chỉ được ghi các file trong dòng `Ghi`.
2. Khi subagent xong, chạy `pp gate <feature> <stage>`.
3. Gate đỏ → đưa nguyên output gate cho subagent sửa, chạy lại gate. Tối đa 3 lần.
4. Gate xanh và stage cần duyệt → dừng, báo người dùng chạy `pp approve`.
5. Không bao giờ tự ghi `STATE.md` hoặc `.evidence/`.
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `node --test tests/cmd-gate.test.js`
Expected: PASS — 2 test xanh.

- [ ] **Step 5: Chạy toàn bộ test rồi commit**

```bash
node --test tests/
git add lib/registry.js lib/commands/ bin/pp commands/pp.md tests/cmd-gate.test.js
git commit -m "feat(pp): lệnh gate và advance, slash command /pp"
```

---

## Task 12: Hooks — biến gate thành luật

**Files:**
- Create: `hooks/pre-tool-use.sh`
- Create: `hooks/stop.sh`
- Create: `lib/commands/guard.js`
- Modify: `bin/pp`
- Modify: `~/.claude/settings.json`
- Test: `tests/cmd-guard.test.js`

**Interfaces:**
- Consumes: `readState`, `readConfig`
- Produces:
  - `pp guard-write --path <abs> [--root DIR]` → exit 0 cho phép, exit 1 chặn (in lý do). Chặn khi path là `STATE.md` hoặc nằm trong `.evidence/`.
  - `pp guard-stop <feature>` → exit 0 cho phép kết thúc, exit 1 nếu có stage `in_progress` hoặc `failed`.

- [ ] **Step 1: Viết test thất bại**

```js
// tests/cmd-guard.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const PP = new URL('../bin/pp', import.meta.url).pathname
function run(args) {
  try { return { code: 0, out: execFileSync('node', [PP, ...args], { encoding: 'utf8' }) } }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') } }
}

test('chặn ghi STATE.md', () => {
  const r = run(['guard-write', '--path', '/x/features/demo/STATE.md'])
  assert.equal(r.code, 1)
  assert.match(r.out, /STATE\.md/)
})

test('chặn ghi trong .evidence/', () => {
  assert.equal(run(['guard-write', '--path', '/x/features/demo/.evidence/10-prd.log']).code, 1)
})

test('cho phép ghi artifact bình thường', () => {
  assert.equal(run(['guard-write', '--path', '/x/features/demo/10-prd.md']).code, 0)
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `node --test tests/cmd-guard.test.js`
Expected: FAIL — `pp: không biết lệnh "guard-write"`.

- [ ] **Step 3: Viết implementation tối thiểu**

```js
// lib/commands/guard.js
import { join } from 'node:path'
import { readConfig } from '../config.js'
import { readState } from '../state.js'

export function guardWriteCmd(args) {
  const i = args.indexOf('--path')
  if (i === -1) return 0
  const p = args[i + 1] ?? ''
  if (/\/STATE\.md$/.test(p)) {
    process.stdout.write('pp: STATE.md chỉ được ghi bởi `pp`. Dùng `pp gate` / `pp approve`.\n')
    return 1
  }
  if (/\/\.evidence\//.test(p)) {
    process.stdout.write('pp: .evidence/ chỉ được ghi bởi `pp`. Hoàn thành là dữ kiện, không phải lời khai.\n')
    return 1
  }
  return 0
}

export function guardStopCmd(args, { root }) {
  const feature = args.find((a) => !a.startsWith('--'))
  if (!feature) return 0
  const dir = join(root, 'features', feature)
  let state
  try { state = readState(dir); readConfig(dir) } catch { return 0 }
  for (const [id, st] of Object.entries(state.stages ?? {})) {
    if (st.status === 'in_progress' || st.status === 'failed') {
      process.stdout.write(`pp: stage ${id} đang ${st.status} — chạy \`pp gate ${feature} ${id}\` cho xanh trước khi dừng.\n`)
      return 1
    }
  }
  return 0
}
```

```bash
#!/usr/bin/env bash
# hooks/pre-tool-use.sh — chặn agent ghi STATE.md và .evidence/
# stdin: JSON của Claude Code hook. Lấy đường dẫn file bằng grep, không cần jq.
set -euo pipefail
PAYLOAD="$(cat)"
FILE_PATH="$(printf '%s' "$PAYLOAD" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
[ -z "${FILE_PATH:-}" ] && exit 0
exec node "$(dirname "$0")/../bin/pp" guard-write --path "$FILE_PATH"
```

```bash
#!/usr/bin/env bash
# hooks/stop.sh — chặn kết thúc lượt khi còn stage chưa xanh
# PP_FEATURE do /pp đặt; không có thì không chặn gì.
set -euo pipefail
[ -z "${PP_FEATURE:-}" ] && exit 0
exec node "$(dirname "$0")/../bin/pp" guard-stop "$PP_FEATURE"
```

Đăng ký `guard-write: guardWriteCmd, guard-stop: guardStopCmd` trong `COMMANDS` của `bin/pp`.

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `chmod +x hooks/*.sh && node --test tests/cmd-guard.test.js`
Expected: PASS — 3 test xanh.

- [ ] **Step 5: Nối hook vào Claude Code**

Thêm vào `hooks` trong `~/.claude/settings.json` — **giữ nguyên hook `SessionStart` của herdr đang có**:

```json
"PreToolUse": [
  { "matcher": "Write|Edit",
    "hooks": [{ "type": "command", "command": "bash '/path/to/agent-product-pipeline/hooks/pre-tool-use.sh'", "timeout": 5 }] }
],
"Stop": [
  { "matcher": "*",
    "hooks": [{ "type": "command", "command": "bash '/path/to/agent-product-pipeline/hooks/stop.sh'", "timeout": 5 }] }
]
```

Kiểm chứng bằng tay: mở session mới, thử bảo Claude ghi vào `features/demo/STATE.md` → phải bị chặn với thông báo của `pp`.

- [ ] **Step 6: Commit**

```bash
git add hooks/ lib/commands/guard.js bin/pp tests/cmd-guard.test.js
git commit -m "feat(pp): hooks PreToolUse và Stop biến gate thành luật"
```

---

## Task 13: T2 reviewer đối kháng

**Files:**
- Create: `agents/pp-reviewer.md`
- Create: `rubric/10-prd.md`
- Create: `rubric/40-testplan.md`
- Create: `lib/commands/review.js`
- Modify: `bin/pp`
- Test: `tests/cmd-review.test.js`

**Interfaces:**
- Consumes: `readConfig`, `newEvidence`, `readState`/`writeState`
- Produces:
  - `pp review-prompt <feature> <stage>` → in prompt đầy đủ cho subagent reviewer (artifact + rubric + constitution). `pp` **không gọi LLM**; `/pp` cầm prompt này đi mở subagent.
  - `pp review-record <feature> <stage> --verdict <file.json>` → đọc verdict JSON của reviewer, ghi evidence T2, cập nhật state. Có bất kỳ finding `severity: high` → exit 1.
  - Verdict schema: `{ findings: [{ criterion, verdict: "pass"|"fail", severity: "high"|"medium"|"low", evidence, fix }] }`

- [ ] **Step 1: Viết test thất bại**

```js
// tests/cmd-review.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const PP = new URL('../bin/pp', import.meta.url).pathname
const REPO = new URL('../', import.meta.url).pathname
function run(args) {
  try { return { code: 0, out: execFileSync('node', [PP, ...args], { encoding: 'utf8' }) } }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') } }
}
function root() {
  const d = mkdtempSync(join(tmpdir(), 'pp-r-'))
  writeFileSync(join(d, 'constitution.md'), '# Constitution\nĐiều 1 — Đơn giản\n')
  for (const sub of ['schema', 'templates', 'rubric']) {
    mkdirSync(join(d, sub), { recursive: true })
    cpSync(join(REPO, sub), join(d, sub), { recursive: true })
  }
  return d
}

test('review-prompt chứa artifact, rubric và constitution', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  writeFileSync(join(r0, 'features/demo/10-prd.md'), 'NỘI DUNG PRD')
  const r = run(['review-prompt', 'demo', '10-prd', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /NỘI DUNG PRD/)
  assert.match(r.out, /Điều 1 — Đơn giản/)
  assert.match(r.out, /REJECT/)
})

test('verdict có finding high thì exit 1 và state = failed', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const f = join(r0, 'features/demo')
  writeFileSync(join(f, '10-prd.md'), 'x')
  const v = join(f, 'verdict.json')
  writeFileSync(v, JSON.stringify({ findings: [
    { criterion: 'AC đo được', verdict: 'fail', severity: 'high', evidence: 'AC-1-1 mơ hồ', fix: 'viết lại EARS' },
  ] }))
  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /AC-1-1 mơ hồ/)
})

test('chỉ có finding medium thì exit 0', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const f = join(r0, 'features/demo')
  writeFileSync(join(f, '10-prd.md'), 'x')
  const v = join(f, 'verdict.json')
  writeFileSync(v, JSON.stringify({ findings: [
    { criterion: 'x', verdict: 'fail', severity: 'medium', evidence: 'e', fix: 'f' },
  ] }))
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0]).code, 0)
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `node --test tests/cmd-review.test.js`
Expected: FAIL — `pp: không biết lệnh "review-prompt"`.

- [ ] **Step 3: Viết implementation tối thiểu**

`rubric/10-prd.md` — **viết tiêu chí từ mục "Chỗ sơ sài" trong `tests/fixtures/real/NOTES.md` (Task 8 Step 6)**, không bịa. Khung tối thiểu, mỗi tiêu chí phải có cả hai vế:

```markdown
# Rubric — 10-prd

Với MỖI tiêu chí, trả verdict kèm **trích dẫn nguyên văn** từ artifact. Không trích dẫn được = fail.

## 1. AC đo được
- Đạt: mỗi AC nêu điều kiện kích hoạt và kết quả quan sát được, một hành vi duy nhất.
- Trượt: "hệ thống hoạt động tốt", "xử lý phù hợp", hai hành vi trong một AC.
- Severity khi trượt: **high**

## 2. Ranh giới phạm vi rõ
- Đạt: `## Out of scope` liệt kê thứ cụ thể đã cân nhắc rồi loại.
- Trượt: mục rỗng, hoặc chỉ ghi "những gì không nêu ở trên".
- Severity: **high**

## 3. Neo vào code thật
- Đạt: nhắc tới file/endpoint có thật, đường dẫn tồn tại.
- Trượt: mô tả hệ thống chung chung không tham chiếu code hiện có.
- Severity: **high**

## 4. Rủi ro được trả lời thực chất
- Đạt: mỗi mục checklist có kết luận riêng cho feature này.
- Trượt: "không áp dụng" không kèm lý do; câu trả lời chung chung dùng cho feature nào cũng được.
- Severity: **medium**

## 5. Không phình phạm vi
- Đạt: mọi story truy được về brief.
- Trượt: có story agent tự nghĩ ra mà brief không yêu cầu (vi phạm Điều 1).
- Severity: **medium**

<!-- Bổ sung tiêu chí 6+ từ mục "Chỗ sơ sài" của tests/fixtures/real/NOTES.md -->
```

`rubric/40-testplan.md` — cùng khung, tiêu chí gồm: phủ edge case thực chất · negative case kiểm đúng thứ đáng kiểm · precondition đủ để chạy lại được · **phép thử đột biến**: "nếu implement sai theo cách X thì test nào bắt được?" (severity **high** nếu không test nào bắt).

```markdown
<!-- agents/pp-reviewer.md -->
---
name: pp-reviewer
description: Reviewer đối kháng chấm artifact pipeline theo rubric. Mặc định REJECT.
tools: Read, Grep, Glob
---

Bạn là reviewer đối kháng. Bạn **không** viết lại artifact và **không** khen.

Nhiệm vụ: tìm lỗi. Mặc định của bạn là artifact **chưa đạt** cho tới khi bằng chứng chứng minh ngược lại.

Với mỗi tiêu chí trong rubric được đưa:
- đọc artifact, tìm **trích dẫn nguyên văn** ủng hộ verdict của bạn
- không trích dẫn được thì verdict là `fail`
- severity lấy đúng theo rubric

Trả về **chỉ JSON**, không lời dẫn:

```json
{ "findings": [
  { "criterion": "...", "verdict": "pass|fail", "severity": "high|medium|low",
    "evidence": "trích dẫn nguyên văn từ artifact", "fix": "hành động cụ thể" }
] }
```

Bạn không được ghi bất kỳ file nào.
```

```js
// lib/commands/review.js
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readConfig } from '../config.js'
import { readState, writeState } from '../state.js'
import { newEvidence } from '../evidence.js'
import { MAX_ATTEMPTS } from '../plan.js'

function artifactPath(config, stageId) {
  const outs = config.stages[stageId].outputs
  return outs[outs.length - 1]
}

export function reviewPromptCmd(args, { root }) {
  const [feature, stageId] = args.filter((a) => !a.startsWith('--'))
  if (!feature || !stageId) { process.stdout.write('pp review-prompt <feature> <stage>\n'); return 2 }
  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  const artifact = readFileSync(join(dir, artifactPath(config, stageId)), 'utf8')
  const rubricPath = join(root, 'rubric', `${stageId}.md`)
  if (!existsSync(rubricPath)) { process.stdout.write(`pp: thiếu rubric/${stageId}.md\n`); return 1 }

  process.stdout.write(`Bạn là reviewer đối kháng. Mặc định REJECT. Chỉ trả JSON theo schema trong system prompt.

=== CONSTITUTION ===
${readFileSync(join(root, 'constitution.md'), 'utf8')}

=== RUBRIC (${stageId}) ===
${readFileSync(rubricPath, 'utf8')}

=== ARTIFACT (${artifactPath(config, stageId)}) ===
${artifact}
`)
  return 0
}

export function reviewRecordCmd(args, { root }) {
  const [feature, stageId] = args.filter((a) => !a.startsWith('--'))
  const vi = args.indexOf('--verdict')
  if (!feature || !stageId || vi === -1) { process.stdout.write('pp review-record <feature> <stage> --verdict <file.json>\n'); return 2 }
  const dir = join(root, 'features', feature)
  const verdict = JSON.parse(readFileSync(args[vi + 1], 'utf8'))
  const highs = (verdict.findings ?? []).filter((f) => f.verdict === 'fail' && f.severity === 'high')

  const state = readState(dir)
  const prev = state.stages?.[stageId] ?? { attempts: 0 }
  const attempt = (prev.attempts ?? 0) + 1
  const ev = newEvidence(dir, stageId, 't2', attempt)
  for (const f of verdict.findings ?? []) {
    ev.record(
      `pp-review ${f.criterion}`,
      f.verdict === 'fail' ? `[${f.severity}] ${f.evidence}\n→ ${f.fix}` : '',
      f.verdict === 'fail' && f.severity === 'high' ? 1 : 0,
    )
  }
  const ok = highs.length === 0
  const evidence = ev.finish(ok ? 'PASS' : 'FAIL')

  state.stages = state.stages ?? {}
  state.stages[stageId] = {
    ...prev,
    status: ok ? 'done' : attempt >= MAX_ATTEMPTS ? 'blocked' : 'failed',
    attempts: attempt,
    gate: ok ? 'pass' : 'fail',
    evidence,
  }
  writeState(dir, state)
  process.stdout.write(readFileSync(join(dir, evidence), 'utf8'))
  return ok ? 0 : 1
}
```

Đăng ký `'review-prompt': reviewPromptCmd, 'review-record': reviewRecordCmd` trong `COMMANDS`. Bổ sung bước 2b vào `commands/pp.md`: sau khi `pp gate` xanh, nếu `gate` của stage có `"t2"` thì chạy `pp review-prompt`, mở subagent `pp-reviewer` với prompt đó, lưu JSON trả về vào `features/<f>/.review-<stage>.json`, rồi chạy `pp review-record`.

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `node --test tests/cmd-review.test.js`
Expected: PASS — 3 test xanh.

- [ ] **Step 5: Commit**

```bash
git add agents/ rubric/ lib/commands/review.js bin/pp commands/pp.md tests/cmd-review.test.js
git commit -m "feat(pp): T2 reviewer đối kháng với rubric và verdict có cấu trúc"
```

---

## Task 14: `pp approve`, `pp override`, `pp unblock`, `pp report`

**Files:**
- Create: `lib/commands/human.js`
- Create: `lib/commands/report.js`
- Modify: `bin/pp`
- Test: `tests/cmd-human.test.js`

**Interfaces:**
- Consumes: `readState`/`writeState`, `readConfig`, `hasFailure`
- Produces:
  - `pp approve <feature> <stage>` → đặt `human: 'approved'`. Từ chối (exit 1) nếu gate chưa `pass`.
  - `pp override <feature> <stage> --reason "<chữ>"` → đặt `status: 'done'`, `overridden: true`, lưu `reason`; **bắt buộc** có `--reason` khác rỗng, nếu không exit 2. Ghi thêm một dòng vào `lessons/<stage>.md`.
  - `pp unblock <feature> <stage> --reason "<chữ>"` → reset `attempts: 0`, `status: 'pending'`; cũng ghi `lessons/`.
  - `pp report [<feature>]` → in bảng: stage · status · attempts · overridden. Không có tham số thì in mọi feature.

- [ ] **Step 1: Viết test thất bại**

```js
// tests/cmd-human.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readState, writeState } from '../lib/state.js'

const PP = new URL('../bin/pp', import.meta.url).pathname
const REPO = new URL('../', import.meta.url).pathname
function run(args) {
  try { return { code: 0, out: execFileSync('node', [PP, ...args], { encoding: 'utf8' }) } }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') } }
}
function root() {
  const d = mkdtempSync(join(tmpdir(), 'pp-h-'))
  writeFileSync(join(d, 'constitution.md'), '# c\n')
  mkdirSync(join(d, 'lessons'), { recursive: true })
  cpSync(join(REPO, 'templates'), join(d, 'templates'), { recursive: true })
  run(['init', 'demo', '--size', 'S', '--root', d])
  return d
}

test('approve bị từ chối khi gate chưa pass', () => {
  const r0 = root()
  const r = run(['approve', 'demo', '10-prd', '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /gate/)
})

test('approve thành công khi gate pass', () => {
  const r0 = root()
  const dir = join(r0, 'features/demo')
  const s = readState(dir); s.stages = { '10-prd': { status: 'done', gate: 'pass' } }; writeState(dir, s)
  assert.equal(run(['approve', 'demo', '10-prd', '--root', r0]).code, 0)
  assert.equal(readState(dir).stages['10-prd'].human, 'approved')
})

test('override không có --reason thì exit 2', () => {
  const r0 = root()
  assert.equal(run(['override', 'demo', '10-prd', '--root', r0]).code, 2)
})

test('override có lý do thì đánh dấu overridden và ghi lessons', () => {
  const r0 = root()
  const r = run(['override', 'demo', '10-prd', '--reason', 'gate nhận nhầm định dạng bảng', '--root', r0])
  assert.equal(r.code, 0)
  const st = readState(join(r0, 'features/demo')).stages['10-prd']
  assert.equal(st.overridden, true)
  assert.equal(st.status, 'done')
  assert.ok(existsSync(join(r0, 'lessons/10-prd.md')))
  assert.match(readFileSync(join(r0, 'lessons/10-prd.md'), 'utf8'), /nhận nhầm định dạng bảng/)
})

test('report in số lần override', () => {
  const r0 = root()
  run(['override', 'demo', '10-prd', '--reason', 'x', '--root', r0])
  const r = run(['report', 'demo', '--root', r0])
  assert.match(r.out, /override/i)
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `node --test tests/cmd-human.test.js`
Expected: FAIL — `pp: không biết lệnh "approve"`.

- [ ] **Step 3: Viết implementation tối thiểu**

```js
// lib/commands/human.js
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { readState, writeState } from '../state.js'

function parse(args) {
  const positional = args.filter((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--reason' && args[args.indexOf(a) - 1] !== '--root')
  const ri = args.indexOf('--reason')
  return { feature: positional[0], stageId: positional[1], reason: ri === -1 ? '' : (args[ri + 1] ?? '') }
}

function noteLesson(root, stageId, line) {
  mkdirSync(join(root, 'lessons'), { recursive: true })
  appendFileSync(join(root, 'lessons', `${stageId}.md`), `- ${new Date().toISOString().slice(0, 10)} — ${line}\n`)
}

export function approveCmd(args, { root }) {
  const { feature, stageId } = parse(args)
  if (!feature || !stageId) { process.stdout.write('pp approve <feature> <stage>\n'); return 2 }
  const dir = join(root, 'features', feature)
  const state = readState(dir)
  const st = state.stages?.[stageId]
  if (!st || st.gate !== 'pass') {
    process.stdout.write(`pp: ${stageId} chưa có gate pass — không duyệt được.\n`)
    return 1
  }
  st.human = 'approved'
  writeState(dir, state)
  process.stdout.write(`✓ đã duyệt ${stageId}\n`)
  return 0
}

export function overrideCmd(args, { root }) {
  const { feature, stageId, reason } = parse(args)
  if (!feature || !stageId) { process.stdout.write('pp override <feature> <stage> --reason "<lý do>"\n'); return 2 }
  if (!reason.trim()) { process.stdout.write('pp: override bắt buộc có --reason. Cửa thoát hiểm phải ghi sổ.\n'); return 2 }
  const dir = join(root, 'features', feature)
  const state = readState(dir)
  state.stages = state.stages ?? {}
  state.stages[stageId] = { ...(state.stages[stageId] ?? {}), status: 'done', gate: 'pass', overridden: true, reason }
  writeState(dir, state)
  noteLesson(root, stageId, `override (${feature}): ${reason}`)
  process.stdout.write(`⚠ đã override ${stageId} — đã ghi vào lessons/${stageId}.md\n`)
  return 0
}

export function unblockCmd(args, { root }) {
  const { feature, stageId, reason } = parse(args)
  if (!feature || !stageId) { process.stdout.write('pp unblock <feature> <stage> --reason "<lý do>"\n'); return 2 }
  if (!reason.trim()) { process.stdout.write('pp: unblock bắt buộc có --reason.\n'); return 2 }
  const dir = join(root, 'features', feature)
  const state = readState(dir)
  state.stages[stageId] = { ...(state.stages[stageId] ?? {}), status: 'pending', attempts: 0 }
  writeState(dir, state)
  noteLesson(root, stageId, `unblock (${feature}): ${reason}`)
  process.stdout.write(`↻ đã gỡ block ${stageId}, attempts về 0\n`)
  return 0
}
```

```js
// lib/commands/report.js
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readState } from '../state.js'

export function reportCmd(args, { root }) {
  const only = args.find((a) => !a.startsWith('--'))
  const base = join(root, 'features')
  if (!existsSync(base)) { process.stdout.write('chưa có feature nào\n'); return 0 }
  const features = only ? [only] : readdirSync(base).filter((f) => !f.startsWith('_'))

  for (const f of features) {
    const dir = join(base, f)
    let state
    try { state = readState(dir) } catch { continue }
    process.stdout.write(`\n${f}\n  stage         status     attempts  override\n`)
    let overrides = 0
    for (const [id, st] of Object.entries(state.stages ?? {})) {
      if (st.overridden) overrides++
      process.stdout.write(
        `  ${id.padEnd(13)} ${String(st.status ?? 'pending').padEnd(10)} ${String(st.attempts ?? 0).padEnd(9)} ${st.overridden ? 'CÓ' : '-'}\n`,
      )
    }
    process.stdout.write(`  → tổng override: ${overrides}${overrides >= 3 ? '  ⚠ từ 3 trở lên nghĩa là GATE sai — sửa luật gate, đừng sửa người' : ''}\n`)
  }
  return 0
}
```

Đăng ký cả 4 lệnh trong `COMMANDS` và bổ sung vào `USAGE`.

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `node --test tests/cmd-human.test.js`
Expected: PASS — 5 test xanh.

- [ ] **Step 5: Chạy toàn bộ test rồi commit**

```bash
node --test tests/
git add lib/commands/human.js lib/commands/report.js bin/pp tests/cmd-human.test.js
git commit -m "feat(pp): approve, override có ghi sổ, unblock và report"
```

---

## Task 15: Chạy lại feature mồi qua pipeline đầy đủ — đo hiệu quả

> Task nghiệm thu. Không viết code mới. Đây là Step 3 của §10.2 trong spec: **bằng chứng, không phải niềm tin**.

**Files:**
- Create: `features/<feature-mồi>/` (chạy thật)
- Modify: `tests/fixtures/real/NOTES.md` (mục "So sánh trước/sau")

- [ ] **Step 1: Khởi tạo feature mồi qua `pp`**

```bash
cd /path/to/agent-product-pipeline
node bin/pp init <tên-feature-mồi> --size S
```

Chép brief từ `tests/fixtures/real/NOTES.md` vào `features/<tên>/00-brief.md`.

- [ ] **Step 2: Chạy `/pp <tên>` cho tới human gate #1**

Quan sát: subagent có thật sự hỏi ≥8 câu trước khi viết PRD không. Nếu nó viết thẳng PRD thì PreToolUse hook chưa chặn đúng — quay lại Task 12.

- [ ] **Step 3: Trả lời câu hỏi, chạy tiếp tới khi `10-prd` xanh**

Đếm số vòng gate. Ghi lại.

- [ ] **Step 4: Chạy tiếp tới `40-testplan` xanh**

- [ ] **Step 5: So sánh và ghi kết luận**

Ghi vào `tests/fixtures/real/NOTES.md` mục "So sánh trước/sau":

| Chỉ số | Bản chạy tay (Task 8) | Bản qua pipeline |
|---|---|---|
| Số AC | | |
| Số AC viết EARS đo được | | |
| Số test case | | |
| Số AC được test phủ | | |
| Số edge case | | |
| Thời gian phần phi-dev | | |
| Số vòng gate | | |

- [ ] **Step 6: Đối chiếu tiêu chí khai tử (§10.4 của spec)**

- Thời gian phần phi-dev **>30 phút** → cắt bớt stage, hoặc dừng dự án này.
- `override` nhiều hơn `approve` → dừng xây Plan 2, sửa gate trước.
- Chất lượng **không khác** bản chạy tay → vứt lớp conductor, chỉ giữ T1 gate + rubric.

Ghi kết luận đi/dừng vào `NOTES.md`. **Đây là quyết định của con người, không phải của agent.**

- [ ] **Step 7: Commit**

```bash
git add features/ tests/fixtures/real/NOTES.md
git commit -m "test(bootstrap): chạy feature mồi qua pipeline đầy đủ và đo kết quả"
```

---

## Self-Review

**1. Spec coverage** — đối chiếu từng mục của spec với task:

| Mục spec | Task | Ghi chú |
|---|---|---|
| §3 kiến trúc 3 lớp | 1–7 | `pp` + blackboard; toolbox không đụng |
| §4 stage map, `pipeline.yml` | 2, 7 | dùng `pipeline.json` — deviation đã ghi ở Global Constraints |
| §5.1 T1 chung | 6 | placeholder · heading · cited-paths |
| §5.1 `10-prd` (EARS, id, out-of-scope, rủi ro) | 9 | |
| §5.1 `40-testplan` (traceability, schema, tỉ lệ) | 10 | bảng edge case: schema có, **check tự động để lại Plan 2** — xem "Gap" dưới |
| §5.1 `30-contract` / `50-security` / `70-ops` | — | **ngoài phạm vi Phase 1**, đã tuyên bố |
| §5.2 XML tag | 9, 10 | |
| §5.3 ba điểm chặn | 6, 11, 12 | |
| §6 trụ cột 1 (T2 reviewer) | 13 | |
| §6 trụ cột 2 (ép hỏi trước) | 9 (`checkQuestionsAnswered`) + 12 (hook) | |
| §6 trụ cột 3 (neo code thật) | 6 (`checkCitedPaths`) | |
| §6 trụ cột 4 (testcase) | 10 | |
| §6 trụ cột 5 (chống over-engineer) | — | **Plan 2** — cần `pp handoff` và diff review |
| §6 trụ cột 6 (lessons) | 14 (`noteLesson`) | vòng inject vào prompt để **Plan 2** |
| §7.3 STATE.md | 3 | |
| §7.4 evidence | 5 | |
| §7.5 vô hiệu hoá ngược dòng | 3 (`isStale`) + 4 (`regate`) | |
| §7.7 phân quyền ghi | 12 | |
| §8 mối nối Herdr | — | **Plan 2** |
| §9.1 tập trạng thái | 4, 6 | |
| §9.2 escape hatch | 14 | |
| §9.4 tự giám sát | 14 (`pp report`) | |
| §10.2 bootstrap | 8, 15 | |
| §10.4 tiêu chí khai tử | 15 Step 6 | |

**Gap đã biết, ghi rõ để không tưởng là đã phủ:**
- **Bảng edge case bắt buộc** (§5.1) mới có trong `schema/40-testplan.json` nhưng **chưa có check tự động** — hiện do rubric T2 kiểm bằng mắt. Tự động hoá ở Plan 2 khi đã biết định dạng thật của bảng.
- **`pp size`** (v2), **chấm điểm** (v2), **`pp board`** (v2), **`90-archive`** — đúng như §10.3 xếp vào bước 8.

**2. Placeholder scan** — mọi step đều có lệnh chạy được hoặc code thật. Không có "tương tự Task N". Task 8 và 15 không có code vì sản phẩm của chúng là dữ liệu và quyết định, và điều đó được nêu rõ ngay đầu task.

**3. Type consistency** — đã đối chiếu: `CheckResult {name, ok, messages}` giữ nguyên qua Task 6/9/10; `Check {name, run(text, ctx)}` khớp giữa `registry.js` và `gate.js`; `parseAcIds` export ở Task 10 Step 3 và được `testplan.js` dùng; `MAX_ATTEMPTS` khai ở `lib/plan.js` (Task 4) và dùng lại ở `evidence.js` (Task 5), `gate.js` (Task 6), `review.js` (Task 13); `evidencePath()` trả chuỗi tương đối ở cả Task 5 và 6.

**Lưu ý phụ thuộc bắt buộc:** `lib/evidence.js` import `MAX_ATTEMPTS` từ `lib/plan.js`, nên **Task 4 phải làm trước Task 5**. Thứ tự task trong plan này đã đúng — đừng đảo.
