# pp-bugfix & pp-change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm hai loại pipeline mới — bugfix (`05-diagnosis → 15-fixplan → 40-regression`) và change (`05-impact → 10-prd delta → 40-testplan`) — chọn bằng `pp init --type`, kèm hai slash command `/pp-bugfix`, `/pp-change`.

**Architecture:** Mỗi loại việc một template trong `templates/`; bộ máy gate/state/audit/stale dùng chung không đổi. Ba mở rộng nhỏ: config đọc thêm field (`type`, `from`, per-stage `schema`, `reads_workspace`), registry nhận schema override, advance in thêm ranh giới đọc workspace. Spec đã duyệt: `docs/specs/2026-08-20-pp-bugfix-pp-change-design.md`.

**Tech Stack:** Node.js ≥18 thuần (ESM, không dependency runtime), test bằng `node --test`, lint bằng biome.

## Global Constraints

- Node ≥18, ESM (`"type": "module"`), KHÔNG thêm dependency mới.
- Style code khớp repo: KHÔNG dấu chấm phẩy cuối dòng, nháy đơn, comment tiếng Việt giải thích "vì sao" (xem lib/commands/init.js làm mẫu).
- Test: `node --test tests/<file>.js` cho từng file, `npm test` chạy cả suite. Lint: `npm run lint`.
- Exit code là hợp đồng: 0 = ok/xanh, 1 = từ chối/đỏ, 2 = đối số sai, 3 = blocked.
- KHÔNG sửa: `lib/gate.js`, `lib/commands/guard.js`, `lib/plan.js`, `lib/state.js`, `lib/evidence.js`, `commands/pp.md`.
- Template ship theo PKG_ROOT (vị trí cài pp), KHÔNG theo `--root` (xem comment đầu lib/commands/init.js).
- Mọi thông báo mới bằng tiếng Việt, giọng như thông báo hiện có.
- Fixture test phải tự thoả luật T1: frontmatter 4 khoá đúng feature/stage, không TBD/TODO/`???`, không cite path chết trong backtick.
- Commit sau MỖI task, message kiểu `feat(...)`/`test(...)`/`docs(...)` tiếng Việt như lịch sử repo.

---

### Task 1: config.js — đọc `type`, `from`, `schema`, `reads_workspace`

**Files:**
- Modify: `lib/config.js`
- Test: `tests/config-type.test.js` (mới)

**Interfaces:**
- Consumes: `readConfig(featureDir)` hiện có.
- Produces: `readConfig` trả thêm `type` (string, mặc định `'feature'`), `from` (string | undefined); mỗi stage thêm `schema` (string | undefined), `readsWorkspace` (boolean, mặc định `false`). Task 2 dùng `stage.schema`, Task 3 dùng `stage.readsWorkspace`, Task 4-5 dùng `type`/`from`.

- [ ] **Step 1: Viết test đỏ**

Tạo `tests/config-type.test.js`:

```js
// Task 1 (pp-bugfix/pp-change): readConfig phải trả các field mới với default
// đúng — template cũ (không có type/schema/reads_workspace) giữ nguyên hành vi.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig } from '../lib/config.js'

function dirWith(json) {
  const d = mkdtempSync(join(tmpdir(), 'pp-cfg-'))
  writeFileSync(join(d, 'pipeline.json'), JSON.stringify(json))
  return d
}

const STAGE = { enabled: true, inputs: ['00-brief.md'], outputs: ['x.md'], gate: ['t1'] }

test('pipeline.json không có type/from → type mặc định "feature", from undefined', () => {
  const c = readConfig(dirWith({ feature: 'demo', stages: { '10-prd': STAGE } }))
  assert.equal(c.type, 'feature')
  assert.equal(c.from, undefined)
})

test('type/from trong pipeline.json đi ra nguyên vẹn', () => {
  const c = readConfig(dirWith({ feature: 'demo', type: 'change', from: 'old-widget', stages: { '05-impact': STAGE } }))
  assert.equal(c.type, 'change')
  assert.equal(c.from, 'old-widget')
})

test('stage không khai schema/reads_workspace → schema undefined, readsWorkspace false', () => {
  const c = readConfig(dirWith({ feature: 'demo', stages: { '10-prd': STAGE } }))
  assert.equal(c.stages['10-prd'].schema, undefined)
  assert.equal(c.stages['10-prd'].readsWorkspace, false)
})

test('stage khai schema + reads_workspace → đọc được qua config', () => {
  const c = readConfig(dirWith({
    feature: 'demo',
    stages: { '10-prd': { ...STAGE, schema: '10-prd.change', reads_workspace: true } },
  }))
  assert.equal(c.stages['10-prd'].schema, '10-prd.change')
  assert.equal(c.stages['10-prd'].readsWorkspace, true)
})
```

- [ ] **Step 2: Chạy test, phải ĐỎ**

Run: `node --test tests/config-type.test.js`
Expected: FAIL — `c.type` là `undefined` (chưa có field), `readsWorkspace` là `undefined`.

- [ ] **Step 3: Sửa `lib/config.js`**

Trong `readConfig`, sửa object stage và return (giữ nguyên phần còn lại):

```js
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
      // pp-bugfix/pp-change: schema override (registry nạp schema/<tên>.json
      // thay vì schema/<stage-id>.json) và ranh giới đọc workspace (advance in
      // thêm một dòng chỉ thị). Cả hai optional — template cũ không đổi hành vi.
      schema: s.schema,
      readsWorkspace: s.reads_workspace ?? false,
    }
  }
  // `type` phân loại pipeline (feature|bugfix|change) cho status/report/audit;
  // `from` là feature gốc mà pp init --from đã liên kết (chỉ type change có).
  return { feature: raw.feature, size: raw.size ?? 'M', type: raw.type ?? 'feature', from: raw.from, stages }
```

- [ ] **Step 4: Chạy test, phải XANH**

Run: `node --test tests/config-type.test.js`
Expected: PASS cả 4 test.

- [ ] **Step 5: Chạy cả suite + lint rồi commit**

Run: `npm test && npm run lint`
Expected: toàn bộ xanh (field mới là additive, không test cũ nào đọc chúng).

```bash
git add lib/config.js tests/config-type.test.js
git commit -m "feat(config): đọc type/from cấp pipeline + schema/reads_workspace cấp stage"
```

---

### Task 2: Schema override — registry, gate, advance + `schema/10-prd.change.json`

**Files:**
- Modify: `lib/registry.js`, `lib/commands/gate.js`, `lib/commands/advance.js`
- Create: `schema/10-prd.change.json`
- Test: `tests/registry-override.test.js` (mới)

**Interfaces:**
- Consumes: `stage.schema` từ Task 1; `loadSchema(root, name)` và `checksFor(stageId, featureDir, root, workspace)` hiện có.
- Produces: `checksFor(stageId, featureDir, root, workspace, schemaName = stageId)` — tham số thứ 5 mới; `requiredHeadings(root, stage)` trong advance.js nhận STAGE CONFIG (không phải id). Task 7 dựa vào việc gate/advance của stage `10-prd` type change dùng `schema/10-prd.change.json`.

- [ ] **Step 1: Tạo `schema/10-prd.change.json`**

Toàn bộ schema 10-prd hiện tại + heading `## Delta` (PRD delta đánh dấu ADDED/MODIFIED/REMOVED — pattern OpenSpec, spec §5.2):

```json
{
  "requiredHeadings": ["## Delta", "## User stories", "## Out of scope", "## Rủi ro"],
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

- [ ] **Step 2: Viết test đỏ**

Tạo `tests/registry-override.test.js`:

```js
// Task 2 (pp-bugfix/pp-change): stage có field "schema" trong pipeline.json
// phải được gate VÀ advance đọc schema/<override>.json — cùng một nguồn, nếu
// không chỉ thị và gate sẽ nói khác nhau (đúng cái bẫy comment đầu advance.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checksFor } from '../lib/registry.js'

const REPO = new URL('../', import.meta.url).pathname
const tmp = () => mkdtempSync(join(tmpdir(), 'pp-reg-ov-'))

test('checksFor không truyền schemaName → hành vi cũ (schema/10-prd.json, không có Delta)', () => {
  const headings = checksFor('10-prd', tmp(), REPO).find((c) => c.name === 'headings')
  const r = headings.run('')
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /## User stories/)
  assert.doesNotMatch(r.messages.join('\n'), /## Delta/)
})

test('checksFor với schemaName "10-prd.change" nạp schema override và VẪN giữ bộ check PRD', () => {
  const checks = checksFor('10-prd', tmp(), REPO, undefined, '10-prd.change')
  // Giữ nguyên bộ check theo STAGE ID: ears/ids/risk-checklist/questions không mất.
  assert.deepEqual(checks.map((c) => c.name),
    ['frontmatter', 'placeholders', 'headings', 'cited-paths', 'ears', 'ids', 'risk-checklist', 'questions'])
  const r = checks.find((c) => c.name === 'headings').run('')
  assert.match(r.messages.join('\n'), /## Delta/)
})

// Chống trôi dạt hai file: schema change phải là SUPERSET của schema gốc
// (spec §5.2 — thêm Delta, không bớt gì).
test('10-prd.change.json là superset heading + giữ nguyên riskChecklist/minQuestions của 10-prd.json', () => {
  const base = JSON.parse(readFileSync(join(REPO, 'schema/10-prd.json'), 'utf8'))
  const change = JSON.parse(readFileSync(join(REPO, 'schema/10-prd.change.json'), 'utf8'))
  for (const h of base.requiredHeadings) {
    assert.ok(change.requiredHeadings.includes(h), `10-prd.change.json thiếu heading gốc "${h}"`)
  }
  assert.deepEqual(change.riskChecklist, base.riskChecklist)
  assert.equal(change.minQuestions, base.minQuestions)
})
```

- [ ] **Step 3: Chạy test, phải ĐỎ**

Run: `node --test tests/registry-override.test.js`
Expected: test 1 và 3 PASS (file schema đã tạo ở Step 1), test 2 FAIL — `checksFor` chưa nhận tham số thứ 5, headings không có `## Delta`.

- [ ] **Step 4: Sửa `lib/registry.js`**

Đổi chữ ký `checksFor` (một dòng khai báo + một dòng dùng):

```js
// `schemaName` (pp-bugfix/pp-change): stage có thể khai "schema" trong
// pipeline.json để nạp schema/<tên>.json thay vì schema/<stage-id>.json —
// dùng cho 10-prd của pipeline change (giữ id → giữ bộ check PRD, nhưng đòi
// thêm heading Delta). Mặc định = stageId, hành vi cũ không đổi.
export function checksFor(stageId, featureDir, root, workspace, schemaName = stageId) {
  const schema = loadSchema(root, schemaName)
```

(phần còn lại của hàm giữ nguyên — `prdChecks(schema)`/`testplanChecks(featureDir, schema)` tự nhận schema override qua biến `schema`.)

- [ ] **Step 5: Sửa `lib/commands/gate.js` — truyền override**

Dòng gọi `runT1` hiện tại:

```js
  const r = runT1(dir, config, state, stageId, checksFor(stageId, dir, root, workspace))
```

thành:

```js
  const stage = config.stages[stageId]
  const r = runT1(dir, config, state, stageId,
    checksFor(stageId, dir, root, workspace, stage.schema ?? stageId))
```

- [ ] **Step 6: Sửa `lib/commands/advance.js` — heading đọc đúng schema override**

Hàm `requiredHeadings` hiện nhận `(root, stageId)`. Đổi thành nhận stage config:

```js
function requiredHeadings(root, stage) {
  try {
    // stage.schema (pp-bugfix/pp-change): cùng một nguồn schema với gate —
    // override mà chỉ gate biết thì chỉ thị sẽ nói thiếu heading, đúng cái
    // bẫy mà comment đầu hàm này cảnh báo.
    return loadSchema(root, stage.schema ?? stage.id).requiredHeadings ?? []
  } catch {
    // schema méo không được làm `pp advance` chết: gate sẽ báo lỗi đó đúng chỗ.
    return []
  }
}
```

Và callsite (đứng SAU dòng `const s = config.stages[d.stage]`):

```js
  const headings = requiredHeadings(root, s)
```

- [ ] **Step 7: Chạy test, phải XANH**

Run: `node --test tests/registry-override.test.js && node --test tests/registry.test.js && node --test tests/artifact-shape.test.js`
Expected: PASS hết (test cũ của registry/advance không đổi hành vi vì default = stageId).

- [ ] **Step 8: Cả suite + commit**

Run: `npm test && npm run lint`
Expected: xanh.

```bash
git add lib/registry.js lib/commands/gate.js lib/commands/advance.js schema/10-prd.change.json tests/registry-override.test.js
git commit -m "feat(registry): schema override theo stage — gate và advance cùng một nguồn schema"
```

---

### Task 3: `reads_workspace` — chỉ thị advance in ranh giới đọc code repo

**Files:**
- Modify: `lib/commands/advance.js`
- Test: `tests/advance-workspace.test.js` (mới)

**Interfaces:**
- Consumes: `stage.readsWorkspace` từ Task 1.
- Produces: chỉ thị `pp advance` có dòng `Được đọc thêm : code repo trong workspace (CHỈ ĐỌC)` khi stage khai `reads_workspace: true`. Task 6/7 dựa vào dòng này cho 05-diagnosis/05-impact/15-fixplan.

- [ ] **Step 1: Viết test đỏ**

Tạo `tests/advance-workspace.test.js`:

```js
// Task 3 (pp-bugfix/pp-change): stage diagnosis/impact cần soi code thật trong
// workspace — ranh giới đọc phải được NÓI trong chỉ thị (guard chỉ chặn ghi,
// việc nới đọc thuần là chỉ thị). Stage không khai thì tuyệt đối không in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run } from './helpers.js'

test('stage khai reads_workspace: true → chỉ thị có dòng "Được đọc thêm"', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  // Bật cờ trực tiếp trong pipeline.json của feature (test được ghi file này —
  // guard là hook Claude Code, không chạy trong test env).
  const p = join(r0, 'features/demo/pipeline.json')
  const cfg = JSON.parse(readFileSync(p, 'utf8'))
  cfg.stages['10-prd'].reads_workspace = true
  writeFileSync(p, JSON.stringify(cfg, null, 2))
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /Được đọc thêm : code repo trong workspace \(CHỈ ĐỌC/)
})

test('stage không khai reads_workspace → chỉ thị KHÔNG có dòng đó', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.out, /Được đọc thêm/)
})
```

- [ ] **Step 2: Chạy test, phải ĐỎ**

Run: `node --test tests/advance-workspace.test.js`
Expected: test 1 FAIL (chưa có dòng), test 2 PASS.

- [ ] **Step 3: Sửa template chỉ thị trong `lib/commands/advance.js`**

Trong chuỗi lớn `process.stdout.write(...)`, ngay SAU dòng `  Ghi       : ${s.outputs.join(', ')}` (và trước dòng `${headings.length ? ...}`), chèn:

```js
${s.readsWorkspace ? '  Được đọc thêm : code repo trong workspace (CHỈ ĐỌC — không ghi file nào ngoài dòng Ghi)\n' : ''}${headings.length ? `  Heading bắt buộc : ${headings.join(' · ')}\n` : ''}  Tier bắt buộc : ...
```

(giữ nguyên phần `${headings.length ? ...}` — chỉ chèn thêm biểu thức mới phía trước nó, trên cùng một dòng template để không sinh dòng trống.)

- [ ] **Step 4: Chạy test, phải XANH**

Run: `node --test tests/advance-workspace.test.js`
Expected: PASS cả 2.

- [ ] **Step 5: Cả suite + commit**

Run: `npm test && npm run lint`

```bash
git add lib/commands/advance.js tests/advance-workspace.test.js
git commit -m "feat(advance): in ranh giới đọc workspace cho stage khai reads_workspace"
```

---

### Task 4: Templates bugfix/change + `pp init --type`

**Files:**
- Create: `templates/pipeline.bugfix.json`, `templates/pipeline.change.json`
- Modify: `templates/pipeline.S.json`, `templates/pipeline.M.json` (thêm `"type": "feature"`), `lib/commands/init.js`, `bin/pp` (dòng usage của init)
- Test: `tests/cmd-init-type.test.js` (mới)

**Interfaces:**
- Consumes: template mechanism của init hiện có (PKG_ROOT, `__FEATURE__`).
- Produces: `pp init <f> --type bugfix|change` tạo feature từ template tương ứng; `pipeline.json` có `"type"`; `00-brief.md` scaffold theo type. Task 5 mở rộng thêm `--from`; Task 6/7 chạy pipeline trên các feature init bằng lệnh này. Tên type hợp lệ: `feature`, `bugfix`, `change` — type lạ exit 2 KHÔNG fallback (khác size).

- [ ] **Step 1: Tạo `templates/pipeline.bugfix.json`**

```json
{
  "feature": "__FEATURE__",
  "type": "bugfix",
  "stages": {
    "05-diagnosis": {
      "enabled": true,
      "skills": [],
      "inputs": ["00-brief.md", "refs/source.md?", "../../constitution.md"],
      "outputs": ["05-diagnosis.md"],
      "gate": ["t1", "t2"],
      "human": true,
      "reads_workspace": true
    },
    "15-fixplan": {
      "enabled": true,
      "skills": [],
      "inputs": ["05-diagnosis.md", "00-brief.md"],
      "outputs": ["15-fixplan.md"],
      "gate": ["t1"],
      "human": false,
      "reads_workspace": true
    },
    "40-regression": {
      "enabled": true,
      "skills": ["test-cases", "test-checklist"],
      "inputs": ["05-diagnosis.md", "15-fixplan.md"],
      "outputs": ["40-regression.md"],
      "gate": ["t1", "t2"],
      "human": false
    }
  }
}
```

- [ ] **Step 2: Tạo `templates/pipeline.change.json`**

```json
{
  "feature": "__FEATURE__",
  "type": "change",
  "stages": {
    "05-impact": {
      "enabled": true,
      "skills": [],
      "inputs": ["00-brief.md", "refs/source.md?", "../../constitution.md"],
      "outputs": ["05-impact.md"],
      "gate": ["t1", "t2"],
      "human": false,
      "reads_workspace": true
    },
    "10-prd": {
      "enabled": true,
      "skills": ["prd-epic", "userstory", "ac"],
      "schema": "10-prd.change",
      "inputs": ["00-brief.md", "05-impact.md", "../../constitution.md"],
      "outputs": ["10-questions.md", "10-prd.md"],
      "gate": ["t1", "t2"],
      "human": true
    },
    "40-testplan": {
      "enabled": true,
      "skills": ["test-cases", "test-checklist"],
      "inputs": ["10-prd.md", "05-impact.md"],
      "outputs": ["40-testplan.md"],
      "gate": ["t1", "t2"],
      "human": false
    }
  }
}
```

- [ ] **Step 3: Thêm `"type": "feature"` vào 2 template cũ**

Trong `templates/pipeline.S.json` và `templates/pipeline.M.json`, sau dòng `"feature": "__FEATURE__",` thêm dòng `"type": "feature",` (giữ nguyên `"size"`).

- [ ] **Step 4: Viết test đỏ**

Tạo `tests/cmd-init-type.test.js`:

```js
// Task 4 (pp-bugfix/pp-change): pp init --type chọn template theo LOẠI VIỆC.
// Type lạ exit 2 KHÔNG fallback — size là gợi ý (fallback M), type là ngữ
// nghĩa của cả pipeline, đoán sai là chạy sai pipeline (spec §3.1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run } from './helpers.js'

test('--type bugfix: pipeline.json đúng type + 3 stage, status trỏ 05-diagnosis', () => {
  const r0 = makeRoot()
  const r = run(['init', 'fix-loi-500', '--type', 'bugfix', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /type bugfix/)
  const cfg = JSON.parse(readFileSync(join(r0, 'features/fix-loi-500/pipeline.json'), 'utf8'))
  assert.equal(cfg.type, 'bugfix')
  assert.deepEqual(Object.keys(cfg.stages), ['05-diagnosis', '15-fixplan', '40-regression'])
  assert.equal(cfg.stages['05-diagnosis'].human, true)
  const st = run(['status', 'fix-loi-500', '--root', r0])
  assert.match(st.out, /05-diagnosis/)
})

test('--type change: pipeline.json đúng type + 3 stage, 10-prd có schema override', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'doi-form', '--type', 'change', '--root', r0]).code, 0)
  const cfg = JSON.parse(readFileSync(join(r0, 'features/doi-form/pipeline.json'), 'utf8'))
  assert.equal(cfg.type, 'change')
  assert.deepEqual(Object.keys(cfg.stages), ['05-impact', '10-prd', '40-testplan'])
  assert.equal(cfg.stages['10-prd'].schema, '10-prd.change')
  assert.equal(cfg.stages['10-prd'].human, true)
})

test('brief scaffold theo type: bugfix có khung Hiện tượng/Mong đợi/Unchanged/tái hiện', () => {
  const r0 = makeRoot()
  run(['init', 'fix-x', '--type', 'bugfix', '--root', r0])
  const brief = readFileSync(join(r0, 'features/fix-x/00-brief.md'), 'utf8')
  for (const khung of ['Hiện tượng', 'Mong đợi', 'Unchanged behavior', 'tái hiện']) {
    assert.match(brief, new RegExp(khung))
  }
})

test('brief scaffold change nói về DELTA trên hành vi đã có', () => {
  const r0 = makeRoot()
  run(['init', 'doi-y', '--type', 'change', '--root', r0])
  const brief = readFileSync(join(r0, 'features/doi-y/00-brief.md'), 'utf8')
  assert.match(brief, /DELTA/)
  assert.match(brief, /05-impact/)
})

test('type lạ → exit 2, KHÔNG tạo thư mục, KHÔNG fallback', () => {
  const r0 = makeRoot()
  const r = run(['init', 'demo', '--type', 'hotfix', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /"hotfix" không hợp lệ/)
  assert.match(r.out, /feature, bugfix, change/)
  assert.ok(!existsSync(join(r0, 'features/demo')))
})

test('không --type → hành vi cũ y nguyên (type feature, size theo --size)', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  const cfg = JSON.parse(readFileSync(join(r0, 'features/demo/pipeline.json'), 'utf8'))
  assert.equal(cfg.type, 'feature')
  assert.equal(cfg.size, 'S')
  assert.deepEqual(Object.keys(cfg.stages), ['10-prd', '40-testplan'])
})
```

- [ ] **Step 5: Chạy test, phải ĐỎ**

Run: `node --test tests/cmd-init-type.test.js`
Expected: FAIL — `--type` chưa tồn tại (bugfix bị hiểu là size? Không: `--type` là flag lạ bị bỏ qua, init tạo type feature → assert type === 'bugfix' fail).

- [ ] **Step 6: Sửa `lib/commands/init.js`**

Thay toàn bộ phần chọn template + ghi file (từ dòng `const requestedSize = ...` đến trước `mkdirSync`) bằng:

```js
  // pp-bugfix/pp-change (spec §3.1): --type chọn LOẠI pipeline. Type lạ exit 2
  // KHÔNG fallback — size là gợi ý nên đoán được, type là ngữ nghĩa của cả
  // pipeline nên đoán sai là chạy sai pipeline.
  const TYPES = ['feature', 'bugfix', 'change']
  const type = typeof flags.type === 'string' ? flags.type : 'feature'
  if (!TYPES.includes(type)) {
    process.stdout.write(
      `pp: --type "${type}" không hợp lệ — chỉ nhận: ${TYPES.join(', ')}.\n` +
      'Không fallback: type là ngữ nghĩa của cả pipeline, không đoán thay.\n',
    )
    return 2
  }

  let size = null
  let tplPath
  let fallbackNote = ''
  if (type === 'feature') {
    const requestedSize = typeof flags.size === 'string' ? flags.size : 'M'
    size = requestedSize
    tplPath = join(PKG_ROOT, 'templates', `pipeline.${size}.json`)
    if (!existsSync(tplPath)) {
      fallbackNote = `pp: không có template cho size "${requestedSize}", dùng M thay thế (fallback)\n`
      size = 'M'
      tplPath = join(PKG_ROOT, 'templates', 'pipeline.M.json')
    }
  } else {
    // --size vô nghĩa với bugfix/change: mỗi type đúng một template.
    tplPath = join(PKG_ROOT, 'templates', `pipeline.${type}.json`)
    if (!existsSync(tplPath)) {
      process.stdout.write(`pp: thiếu templates/pipeline.${type}.json — bản cài pp không toàn vẹn (chạy pp doctor)\n`)
      return 2
    }
  }
  // Parse để (a) bắt template hỏng JSON ngay tại cửa thay vì ghi một
  // pipeline.json hỏng, (b) Task 5 tiêm from/inputs vào object này.
  let pipeline
  try {
    pipeline = JSON.parse(readFileSync(tplPath, 'utf8').replaceAll('__FEATURE__', feature))
  } catch (e) {
    process.stdout.write(`pp: template ${tplPath} không phải JSON hợp lệ: ${e.message}\n`)
    return 2
  }
```

Rồi thay dòng ghi pipeline.json + 00-brief.md hiện tại bằng:

```js
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pipeline.json'), JSON.stringify(pipeline, null, 2) + '\n')
  // Brief scaffold theo type — brief vẫn là tiếng nói của người, nhưng khung
  // gợi ý đúng loại việc (spec §3.1): bugfix cần Unchanged behavior để
  // 40-regression truy vết; change là DELTA trên hành vi ĐÃ CÓ.
  const BRIEFS = {
    feature: `Viết 3–10 dòng dạng DELTA so với hiện trạng: hôm nay hệ thống làm gì,
sau thay đổi này nó làm khác đi ở đâu, và vì sao cần.
`,
    bugfix: `Viết theo bốn mục, mỗi mục 1–3 dòng (thiếu thông tin thì ghi câu hỏi, đừng đoán):

Hiện tượng: hệ thống đang làm SAI gì — mô tả quan sát được, kèm log nếu có.
Mong đợi: đúng ra nó phải thế nào.
Unchanged behavior: những hành vi phải GIỮ NGUYÊN sau khi fix.
Cách tái hiện (nếu biết): các bước + môi trường.
`,
    change: `Viết 3–10 dòng dạng DELTA trên hành vi ĐÃ CÓ: hôm nay hệ thống làm gì
(hành vi nào, ở đâu), sau thay đổi này nó khác đi ở đâu, và vì sao cần.
Có feature gốc trong features/ hay _archive/ thì nêu tên (init --from);
không có thì stage 05-impact sẽ đọc code hiện trạng thay.
`,
  }
  writeFileSync(join(dir, '00-brief.md'), `# Brief — ${feature}\n\n${BRIEFS[type]}`)
```

Cuối hàm, sửa audit + message (size chỉ có nghĩa với feature):

```js
  auditEvent(dir, {
    actor: 'human', event: 'init', feature,
    details: { type, ...(size ? { size } : {}) },
  })
  if (fallbackNote) process.stdout.write(fallbackNote)
  const shape = type === 'feature' ? `size ${size}` : `type ${type}`
  process.stdout.write(`đã tạo features/${feature} (${shape})\nbước tiếp: viết 00-brief.md rồi chạy  pp status ${feature}\n`)
  return 0
```

- [ ] **Step 7: Cập nhật usage trong `bin/pp`**

Dòng `init <feature> [--size S|M]         Tạo blackboard cho feature mới` thành:

```
  init <feature> [--size S|M] [--type feature|bugfix|change]
                                       Tạo blackboard mới; --type chọn pipeline theo loại việc
```

- [ ] **Step 8: Chạy test, phải XANH**

Run: `node --test tests/cmd-init-type.test.js && node --test tests/cmd-init-status.test.js`
Expected: PASS hết — đặc biệt các test cũ (fallback size L→M, message `size M`, `pipeline.size === 'M'`) không đổi hành vi.

- [ ] **Step 9: Cả suite + commit**

Run: `npm test && npm run lint`

```bash
git add templates/ lib/commands/init.js bin/pp tests/cmd-init-type.test.js
git commit -m "feat(init): --type bugfix|change — template theo loại việc, brief scaffold theo type"
```

---

### Task 5: `pp init --from <feature-cũ>` (chỉ type change)

**Files:**
- Modify: `lib/commands/init.js`, `bin/pp` (usage)
- Test: `tests/cmd-init-from.test.js` (mới)

**Interfaces:**
- Consumes: object `pipeline` đã parse từ Task 4.
- Produces: `pipeline.json` có `"from": "<slug>"` và stage `05-impact` được nối thêm inputs `../<cũ>/00-brief.md?`, `../<cũ>/10-prd.md?`, `../<cũ>/40-testplan.md?` (tiền tố `../_archive/` nếu feature cũ đã archive). Task 7 chạy gate trên inputs này. Feature cũ KHÔNG bị ghi gì.

- [ ] **Step 1: Viết test đỏ**

Tạo `tests/cmd-init-from.test.js`:

```js
// Task 5 (pp-bugfix/pp-change): --from liên kết feature gốc cho impact analysis.
// Tiêm inputs phải xảy ra ĐÚNG LÚC init vì pipeline.json chỉ pp được ghi
// (guard chặn agent) — không có cơ hội sửa sau (spec §3.2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run } from './helpers.js'

function withOld(r0, rel) {
  const d = join(r0, 'features', rel)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, '10-prd.md'), '# PRD cũ\n')
  return d
}

test('--from feature đang sống: ghi from + nối inputs ../<cũ>/*', () => {
  const r0 = makeRoot()
  withOld(r0, 'old-widget')
  const r = run(['init', 'doi-widget', '--type', 'change', '--from', 'old-widget', '--root', r0])
  assert.equal(r.code, 0)
  const cfg = JSON.parse(readFileSync(join(r0, 'features/doi-widget/pipeline.json'), 'utf8'))
  assert.equal(cfg.from, 'old-widget')
  const inputs = cfg.stages['05-impact'].inputs
  for (const f of ['../old-widget/00-brief.md?', '../old-widget/10-prd.md?', '../old-widget/40-testplan.md?']) {
    assert.ok(inputs.includes(f), `thiếu input ${f} — có: ${inputs.join(', ')}`)
  }
})

test('--from feature đã archive: tiền tố ../_archive/', () => {
  const r0 = makeRoot()
  withOld(r0, '_archive/old-widget')
  const r = run(['init', 'doi-widget', '--type', 'change', '--from', 'old-widget', '--root', r0])
  assert.equal(r.code, 0)
  const cfg = JSON.parse(readFileSync(join(r0, 'features/doi-widget/pipeline.json'), 'utf8'))
  assert.ok(cfg.stages['05-impact'].inputs.includes('../_archive/old-widget/10-prd.md?'))
})

test('--from không tồn tại: exit 2, liệt kê ứng viên, KHÔNG tạo thư mục', () => {
  const r0 = makeRoot()
  withOld(r0, 'old-widget')
  const r = run(['init', 'doi-x', '--type', 'change', '--from', 'khong-co', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /"khong-co" không tồn tại/)
  assert.match(r.out, /old-widget/)
  assert.ok(!existsSync(join(r0, 'features/doi-x')))
})

test('--from với type khác change: exit 2', () => {
  const r0 = makeRoot()
  withOld(r0, 'old-widget')
  for (const t of [['--type', 'bugfix'], []]) {
    const r = run(['init', 'x-y', ...t, '--from', 'old-widget', '--root', r0])
    assert.equal(r.code, 2)
    assert.match(r.out, /--from chỉ có nghĩa với --type change/)
    assert.ok(!existsSync(join(r0, 'features/x-y')))
  }
})

test('--from không ghi gì vào feature cũ', () => {
  const r0 = makeRoot()
  const oldDir = withOld(r0, '_archive/old-widget')
  const before = readdirSync(oldDir).sort()
  run(['init', 'doi-widget', '--type', 'change', '--from', 'old-widget', '--root', r0])
  assert.deepEqual(readdirSync(oldDir).sort(), before)
})
```

- [ ] **Step 2: Chạy test, phải ĐỎ**

Run: `node --test tests/cmd-init-from.test.js`
Expected: FAIL — flag `--from` bị bỏ qua, `cfg.from` là undefined.

- [ ] **Step 3: Sửa `lib/commands/init.js`**

Thêm `readdirSync` vào import `node:fs`. Ngay SAU khối validate `--type` (trước khối chọn template), thêm:

```js
  // --from (spec §3.2): liên kết feature gốc — chỉ type change có ngữ nghĩa
  // này. Feature cũ có thể đang sống (features/) hoặc đã ship (_archive/).
  const from = typeof flags.from === 'string' ? flags.from : null
  if (from && type !== 'change') {
    process.stdout.write('pp: --from chỉ có nghĩa với --type change (liên kết feature gốc cho impact analysis)\n')
    return 2
  }
  let fromRel = null
  if (from) {
    if (existsSync(join(root, 'features', from))) fromRel = `../${from}`
    else if (existsSync(join(root, 'features', '_archive', from))) fromRel = `../_archive/${from}`
    else {
      const list = (p) => {
        try {
          return readdirSync(p, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
            .map((e) => e.name)
        } catch { return [] }
      }
      const candidates = [
        ...list(join(root, 'features')),
        ...list(join(root, 'features', '_archive')).map((n) => `_archive/${n}`),
      ]
      process.stdout.write(
        `pp: --from "${from}" không tồn tại trong features/ hay features/_archive/.\n` +
        (candidates.length ? `Feature đang có: ${candidates.join(', ')}\n` : 'Chưa có feature nào.\n'),
      )
      return 2
    }
  }
```

Rồi sau khối `pipeline = JSON.parse(...)` của Task 4, thêm phần tiêm:

```js
  if (fromRel) {
    pipeline.from = from
    // Artifact cũ nào thiếu thì `?` bỏ qua — brownfield một phần vẫn chạy.
    pipeline.stages['05-impact'].inputs.push(
      `${fromRel}/00-brief.md?`, `${fromRel}/10-prd.md?`, `${fromRel}/40-testplan.md?`,
    )
  }
```

Và trong `auditEvent`, mở rộng details: `details: { type, ...(size ? { size } : {}), ...(from ? { from } : {}) }`.

- [ ] **Step 4: Cập nhật usage `bin/pp`**

Dòng init (đã sửa ở Task 4) thành:

```
  init <feature> [--size S|M] [--type feature|bugfix|change] [--from <feature-cũ>]
                                       Tạo blackboard mới; --type chọn pipeline theo loại việc,
                                       --from (chỉ change) liên kết feature gốc cho impact analysis
```

- [ ] **Step 5: Chạy test, phải XANH; cả suite + commit**

Run: `node --test tests/cmd-init-from.test.js && npm test && npm run lint`

```bash
git add lib/commands/init.js bin/pp tests/cmd-init-from.test.js
git commit -m "feat(init): --from liên kết feature gốc — tiêm inputs artifact cũ cho 05-impact"
```

---

### Task 6: Schema + rubric bugfix, e2e pipeline bugfix

**Files:**
- Create: `schema/05-diagnosis.json`, `schema/15-fixplan.json`, `schema/40-regression.json`, `rubric/05-diagnosis.md`, `rubric/40-regression.md`
- Test: `tests/bugfix-pipeline.test.js` (mới)

**Interfaces:**
- Consumes: init --type bugfix (Task 4), reads_workspace (Task 3), helpers `makeRoot/run/frontmatter/verdictFile`.
- Produces: pipeline bugfix chạy trọn: gate đỏ/xanh đúng luật, human gate sau 05-diagnosis, hoàn tất ở 40-regression. Fixture DIAGNOSIS/FIXPLAN/REGRESSION nằm trong test file này (Task 7 không dùng lại).

- [ ] **Step 1: Tạo `schema/05-diagnosis.json`**

```json
{
  "requiredHeadings": ["## Tái hiện", "## Root cause", "## Giả thuyết đã loại", "## Unchanged behavior"]
}
```

- [ ] **Step 2: Tạo `schema/15-fixplan.json`**

```json
{
  "requiredHeadings": ["## Phạm vi sửa", "## Hướng sửa", "## Rollback"]
}
```

- [ ] **Step 3: Tạo `schema/40-regression.json`**

```json
{
  "requiredHeadings": ["## Test tái hiện bug", "## Test xác nhận fix", "## Test bảo vệ unchanged"]
}
```

- [ ] **Step 4: Tạo `rubric/05-diagnosis.md`**

(khớp giọng rubric/10-prd.md; KHÔNG cite path trong backtick — rubric bị docs-cites quét)

```markdown
# Rubric — 05-diagnosis

Với MỖI tiêu chí, trả verdict kèm **trích dẫn nguyên văn** từ artifact. Không trích dẫn được = fail.

## 1. Tái hiện được thật
- Đạt: các bước cụ thể một người khác làm theo được, kèm bằng chứng quan sát (log/output/response).
- Trượt: "thỉnh thoảng bị", "khó tái hiện" mà không có bước nào; bằng chứng là lời kể không có output.
- Severity khi trượt: **high**

## 2. Root cause là nguyên nhân, không phải triệu chứng
- Đạt: giải thích CƠ CHẾ gây lỗi (vì sao code hiện tại sinh ra hiện tượng), trỏ vào vị trí code thật.
- Trượt: mô tả lại hiện tượng bằng lời khác; "do backend trả 500" (đó là triệu chứng); không trỏ được vào code.
- Severity: **high**

## 3. Giả thuyết đã loại có căn cứ
- Đạt: mỗi giả thuyết bị loại kèm bằng chứng vì sao loại — chứng tỏ đã điều tra chứ không đoán trúng ngay.
- Trượt: mục rỗng, hoặc "đã kiểm tra các hướng khác" không nói hướng nào.
- Severity: **medium**

## 4. Unchanged behavior cụ thể và đo được
- Đạt: liệt kê hành vi phải giữ nguyên sau fix, mỗi mục quan sát/kiểm được — 40-regression sẽ truy vết về đây.
- Trượt: "mọi thứ khác giữ nguyên"; mục không kiểm được.
- Severity: **high**
```

- [ ] **Step 5: Tạo `rubric/40-regression.md`**

```markdown
# Rubric — 40-regression

Với MỖI tiêu chí, trả verdict kèm **trích dẫn nguyên văn** từ artifact. Không trích dẫn được = fail.

## 1. Test tái hiện đúng bug
- Đạt: mô tả test tái hiện đúng hiện tượng trong diagnosis, và nói rõ nó phải ĐỎ trước khi fix.
- Trượt: test chung chung không gắn với hiện tượng; không có tuyên bố đỏ-trước-fix.
- Severity khi trượt: **high**

## 2. Mỗi mục Unchanged behavior có test truy vết
- Đạt: MỌI mục trong "Unchanged behavior" của diagnosis có ít nhất một test nhắc đích danh mục đó.
- Trượt: có mục Unchanged không test nào phủ.
- Severity: **high**

## 3. Test chạy lại được
- Đạt: mỗi test có tiền điều kiện, bước, kỳ vọng — người khác chạy lại được.
- Trượt: "kiểm tra kỹ các trường hợp" — không có bước nào.
- Severity: **medium**
```

- [ ] **Step 6: Viết test e2e đỏ**

Tạo `tests/bugfix-pipeline.test.js`:

```js
// Task 6 (pp-bugfix/pp-change): pipeline bugfix chạy trọn trên bộ máy sẵn có —
// gate/human/state không sửa dòng nào, chỉ template + schema + rubric mới.
// Fixture tự thoả T1 (frontmatter đúng, không placeholder, không cite path chết).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run, frontmatter, verdictFile } from './helpers.js'

const DIAGNOSIS = frontmatter('05-diagnosis', '00-brief.md', 'fix-500') + `# Diagnosis — fix-500

## Tái hiện

1. Đăng nhập bằng tài khoản nhân viên, mở form feedback.
2. Gửi request multipart với nội dung dài 2001 ký tự.
3. Quan sát: server trả 500 thay vì 400.

Bằng chứng: response body chứa "Internal Server Error"; log server in
"TypeError: Cannot read properties of undefined (reading 'length')".

## Root cause

Handler tạo feedback không kiểm null trước khi đọc độ dài nội dung: validator
độ dài chỉ được gắn cho nhánh JSON, không gắn cho nhánh multipart, nên ở nhánh
multipart biến content là undefined và lời gọi đọc length ném TypeError.

## Giả thuyết đã loại

- Lỗi tầng DB (constraint): loại — log cho thấy exception ném TRƯỚC câu INSERT.
- Client gửi sai content-type: loại — tái hiện được bằng curl với request hợp lệ.

## Unchanged behavior

- Gửi feedback JSON hợp lệ tối đa 2000 ký tự vẫn trả 201 và lưu bản ghi.
- Nội dung rỗng vẫn trả 400 kèm tên trường còn thiếu.
`

const FIXPLAN = frontmatter('15-fixplan', '05-diagnosis.md', 'fix-500') + `# Fix plan — fix-500

## Phạm vi sửa

Module validate feedback phía backend — gắn validator cho nhánh multipart,
một file, ước chừng 15 dòng thay đổi.

## Hướng sửa

Một root cause, một fix: đưa bước validate nội dung (null + độ dài) lên trước
mọi nhánh parse, để JSON lẫn multipart đi qua cùng một kiểm tra.

## Rollback

Revert một commit; không có migration dữ liệu, không đổi contract API.
`

const REGRESSION = frontmatter('40-regression', '05-diagnosis.md', 'fix-500') + `# Regression — fix-500

## Test tái hiện bug

- RT-1: gửi multipart nội dung 2001 ký tự, kỳ vọng 400 — trước fix test này
  phải ĐỎ (hệ đang trả 500), đó là bằng chứng bug tồn tại.

## Test xác nhận fix

- RT-2: sau fix, RT-1 chạy lại phải xanh; thêm case multipart không có field
  nội dung, kỳ vọng 400 kèm tên trường còn thiếu.

## Test bảo vệ unchanged

- RT-3 (Unchanged: JSON hợp lệ tối đa 2000 ký tự): vẫn trả 201 và lưu bản ghi.
- RT-4 (Unchanged: nội dung rỗng): vẫn trả 400 kèm tên trường còn thiếu.
`

function initBugfix() {
  const r0 = makeRoot()
  assert.equal(run(['init', 'fix-500', '--type', 'bugfix', '--root', r0]).code, 0)
  return { r0, dir: join(r0, 'features/fix-500') }
}

test('advance sau init trỏ 05-diagnosis, nêu heading từ schema + ranh giới workspace', () => {
  const { r0 } = initBugfix()
  const r = run(['advance', 'fix-500', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /CHỈ THỊ CHO STAGE 05-diagnosis/)
  assert.match(r.out, /## Tái hiện · ## Root cause · ## Giả thuyết đã loại · ## Unchanged behavior/)
  assert.match(r.out, /Được đọc thêm : code repo trong workspace/)
})

test('gate 05-diagnosis đỏ khi thiếu heading Tái hiện, xanh khi đủ', () => {
  const { r0, dir } = initBugfix()
  writeFileSync(join(dir, '05-diagnosis.md'), DIAGNOSIS.replace('## Tái hiện', '## Tai hien sai'))
  const bad = run(['gate', 'fix-500', '05-diagnosis', '--root', r0])
  assert.equal(bad.code, 1)
  assert.match(bad.out, /thiếu heading bắt buộc "## Tái hiện"/)
  writeFileSync(join(dir, '05-diagnosis.md'), DIAGNOSIS)
  const good = run(['gate', 'fix-500', '05-diagnosis', '--root', r0])
  assert.equal(good.code, 0, good.out)
  assert.match(good.out, /còn thiếu tier: t2/)
})

test('e2e đường xanh: diagnosis → human gate → fixplan (t1-only done ngay) → regression → complete', () => {
  const { r0, dir } = initBugfix()
  // 05-diagnosis: T1 + T2 + chữ ký người
  writeFileSync(join(dir, '05-diagnosis.md'), DIAGNOSIS)
  assert.equal(run(['gate', 'fix-500', '05-diagnosis', '--root', r0]).code, 0)
  const v = verdictFile(r0, 'fix-500', '05-diagnosis', [])
  assert.equal(run(['review-record', 'fix-500', '05-diagnosis', '--verdict', v, '--root', r0]).code, 0)
  // human: true → advance phải DỪNG chờ người, không nhảy sang 15-fixplan
  const wait = run(['advance', 'fix-500', '--root', r0])
  assert.match(wait.out, /🚦 05-diagnosis/)
  // gõ thẳng gate 15-fixplan để đi vòng → bị từ chối (thứ tự là luật trong code)
  writeFileSync(join(dir, '15-fixplan.md'), FIXPLAN)
  assert.equal(run(['gate', 'fix-500', '15-fixplan', '--root', r0]).code, 1)
  assert.equal(run(['approve', 'fix-500', '05-diagnosis', '--root', r0]).code, 0)
  // 15-fixplan: gate ["t1"] → T1 xanh là done luôn, không đòi T2
  const fp = run(['gate', 'fix-500', '15-fixplan', '--root', r0])
  assert.equal(fp.code, 0, fp.out)
  assert.match(fp.out, /✓ 15-fixplan: done/)
  // 40-regression: T1 + T2
  writeFileSync(join(dir, '40-regression.md'), REGRESSION)
  assert.equal(run(['gate', 'fix-500', '40-regression', '--root', r0]).code, 0)
  const v2 = verdictFile(r0, 'fix-500', '40-regression', [])
  const rr = run(['review-record', 'fix-500', '40-regression', '--verdict', v2, '--root', r0])
  assert.equal(rr.code, 0, rr.out)
  assert.match(rr.out, /✓ 40-regression: done/)
  const done = run(['advance', 'fix-500', '--root', r0])
  assert.match(done.out, /✓ fix-500: mọi stage đã xong/)
})
```

- [ ] **Step 7: Chạy test, phải ĐỎ đúng chỗ**

Run: `node --test tests/bugfix-pipeline.test.js`
Expected: FAIL ở assert heading (schema chưa được copy vào makeRoot? — makeRoot copy CẢ thư mục schema/rubric thật, nên sau Step 1-5 file đã có; nếu vẫn đỏ, đọc message gate để sửa fixture, KHÔNG sửa luật).

Lưu ý quan trọng: nếu test đỏ vì `verdictFile` không lấy được nonce cho 05-diagnosis, kiểm tra `rubric/05-diagnosis.md` đã tồn tại — review-prompt exit 2 khi thiếu rubric.

- [ ] **Step 8: Chạy tới xanh, cả suite + commit**

Run: `node --test tests/bugfix-pipeline.test.js && npm test && npm run lint`
Expected: PASS. (Không có bước "implement" riêng — task này là data + fixture; code đã xong từ Task 1-5. Test đỏ chỉ được sửa bằng fixture/schema/rubric, không đụng lib/.)

```bash
git add schema/05-diagnosis.json schema/15-fixplan.json schema/40-regression.json rubric/05-diagnosis.md rubric/40-regression.md tests/bugfix-pipeline.test.js
git commit -m "feat(bugfix): schema + rubric cho 05-diagnosis/15-fixplan/40-regression, e2e pipeline bugfix"
```

---

### Task 7: Schema + rubric change, e2e pipeline change (cả hai chế độ --from / brownfield)

**Files:**
- Create: `schema/05-impact.json`, `rubric/05-impact.md`
- Test: `tests/change-pipeline.test.js` (mới)

**Interfaces:**
- Consumes: init --type change --from (Task 4+5), schema override 10-prd.change (Task 2), helpers `PRD/QUESTIONS/TESTPLAN/frontmatter/verdictFile/forFeature`.
- Produces: pipeline change chạy trọn cả hai chế độ; gate `10-prd` của change ĐÒI `## Delta` trong khi pipeline feature thường KHÔNG đòi.

- [ ] **Step 1: Tạo `schema/05-impact.json`**

```json
{
  "requiredHeadings": ["## Hiện trạng", "## Thành phần bị ảnh hưởng", "## Backward compatibility", "## Rủi ro & lối đi"]
}
```

- [ ] **Step 2: Tạo `rubric/05-impact.md`**

```markdown
# Rubric — 05-impact

Với MỖI tiêu chí, trả verdict kèm **trích dẫn nguyên văn** từ artifact. Không trích dẫn được = fail.

## 1. Hiện trạng có nguồn
- Đạt: mục Hiện trạng nói rõ đọc từ đâu (artifact feature cũ, hay code hiện trạng) và trỏ được vào nguồn đó.
- Trượt: mô tả hiện trạng không nguồn — không phân biệt được ghi nhận với bịa.
- Severity khi trượt: **high**

## 2. Danh sách ảnh hưởng không sót
- Đạt: liệt kê thành phần bị chạm (module/endpoint/contract) đủ để một reviewer không tìm ra chỗ code đang phụ thuộc mà bị bỏ qua.
- Trượt: chỉ nêu chỗ sẽ sửa, bỏ qua chỗ đang GỌI TỚI phần bị sửa.
- Severity: **high**

## 3. Backward compatibility đo được
- Đạt: nói rõ hành vi nào giữ nguyên, ai đang phụ thuộc, và vì sao thay đổi không phá họ.
- Trượt: "tương thích ngược" nói suông không có căn cứ.
- Severity: **high**

## 4. Lối đi được chọn có lý do
- Đạt: chọn một trong chỉnh trực tiếp / rollback / re-scope, kèm lý do gắn với chính thay đổi này.
- Trượt: không chọn, hoặc lý do dùng cho thay đổi nào cũng được.
- Severity: **medium**
```

- [ ] **Step 3: Viết test e2e đỏ**

Tạo `tests/change-pipeline.test.js`:

```js
// Task 7 (pp-bugfix/pp-change): pipeline change — impact 2 chế độ (đối chiếu
// artifact cũ qua --from / brownfield đọc code), PRD delta qua schema override,
// 40-testplan dùng lại nguyên trạng (0 dòng code mới cho stage đó).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run, frontmatter, forFeature, verdictFile, PRD, QUESTIONS, TESTPLAN } from './helpers.js'

const IMPACT = (feature) => frontmatter('05-impact', '00-brief.md', feature) + `# Impact — ${feature}

## Hiện trạng

Nguồn: đọc từ code hiện trạng (không có feature gốc trong features/).
Form feedback hiện chỉ nhận nội dung văn bản tối đa 2000 ký tự, mỗi lần gửi
lưu một bản ghi, danh sách chỉ admin xem được.

## Thành phần bị ảnh hưởng

- Endpoint tạo feedback: thêm field ảnh đính kèm tuỳ chọn.
- Form phía client: thêm nút chọn ảnh.
- Bảng dữ liệu: thêm một cột nullable, không đổi cột hiện có.

## Backward compatibility

Client cũ không gửi field mới vẫn hợp lệ — field là tuỳ chọn, server mặc định
null. Chưa có consumer nào đọc field này trước khi client mới phát hành.

## Rủi ro & lối đi

Chọn chỉnh trực tiếp (không rollback, không re-scope): thay đổi nhỏ, một cột
nullable là đủ; đường lùi là gỡ nút khỏi form, dữ liệu đã lưu không cản gì.
`

// PRD delta = fixture PRD sạch (đã qua mọi check PRD) + section Delta mà
// schema/10-prd.change.json đòi. Chèn TRƯỚC Out of scope.
const DELTA_SECTION = `## Delta

- ADDED: cho phép đính kèm một ảnh khi gửi feedback (mở rộng US-1; hành vi khi không có ảnh giữ nguyên AC-1-1).
- MODIFIED: form gửi feedback thêm nút chọn ảnh — luồng nội dung văn bản không đổi.
- REMOVED: không có.

`
const PRD_DELTA = (feature) => forFeature(PRD, feature).replace('## Out of scope', `${DELTA_SECTION}## Out of scope`)

function completeImpact(r0, feature) {
  const dir = join(r0, 'features', feature)
  writeFileSync(join(dir, '05-impact.md'), IMPACT(feature))
  assert.equal(run(['gate', feature, '05-impact', '--root', r0]).code, 0)
  const v = verdictFile(r0, feature, '05-impact', [])
  assert.equal(run(['review-record', feature, '05-impact', '--verdict', v, '--root', r0]).code, 0)
}

test('advance sau init trỏ 05-impact với heading schema + ranh giới workspace', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'doi-form', '--type', 'change', '--root', r0]).code, 0)
  const r = run(['advance', 'doi-form', '--root', r0])
  assert.match(r.out, /CHỈ THỊ CHO STAGE 05-impact/)
  assert.match(r.out, /## Hiện trạng · ## Thành phần bị ảnh hưởng · ## Backward compatibility · ## Rủi ro & lối đi/)
  assert.match(r.out, /Được đọc thêm : code repo trong workspace/)
})

test('10-prd của change ĐÒI ## Delta (schema override), pipeline feature thường thì KHÔNG', () => {
  const r0 = makeRoot()
  // change: thiếu Delta → đỏ đích danh
  assert.equal(run(['init', 'doi-form', '--type', 'change', '--root', r0]).code, 0)
  const dir = join(r0, 'features/doi-form')
  completeImpact(r0, 'doi-form')
  writeFileSync(join(dir, '10-questions.md'), QUESTIONS)
  writeFileSync(join(dir, '10-prd.md'), forFeature(PRD, 'doi-form'))
  const bad = run(['gate', 'doi-form', '10-prd', '--root', r0])
  assert.equal(bad.code, 1)
  assert.match(bad.out, /thiếu heading bắt buộc "## Delta"/)
  // chỉ thị advance cũng phải NÓI TRƯỚC luật đó (cùng nguồn schema với gate)
  const adv = run(['advance', 'doi-form', '--root', r0])
  assert.match(adv.out, /## Delta/)
  // có Delta → xanh
  writeFileSync(join(dir, '10-prd.md'), PRD_DELTA('doi-form'))
  const good = run(['gate', 'doi-form', '10-prd', '--root', r0])
  assert.equal(good.code, 0, good.out)
  // feature thường: KHÔNG đòi Delta (schema gốc còn nguyên)
  const r1 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r1]).code, 0)
  const d1 = join(r1, 'features/demo')
  writeFileSync(join(d1, '10-questions.md'), QUESTIONS)
  writeFileSync(join(d1, '10-prd.md'), PRD)
  assert.equal(run(['gate', 'demo', '10-prd', '--root', r1]).code, 0)
})

test('e2e change brownfield (không --from): impact → prd delta → human → testplan → complete', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'doi-form', '--type', 'change', '--root', r0]).code, 0)
  const dir = join(r0, 'features/doi-form')
  completeImpact(r0, 'doi-form')
  writeFileSync(join(dir, '10-questions.md'), QUESTIONS)
  writeFileSync(join(dir, '10-prd.md'), PRD_DELTA('doi-form'))
  assert.equal(run(['gate', 'doi-form', '10-prd', '--root', r0]).code, 0)
  const v = verdictFile(r0, 'doi-form', '10-prd', [])
  assert.equal(run(['review-record', 'doi-form', '10-prd', '--verdict', v, '--root', r0]).code, 0)
  assert.match(run(['advance', 'doi-form', '--root', r0]).out, /🚦 10-prd/)
  assert.equal(run(['approve', 'doi-form', '10-prd', '--root', r0]).code, 0)
  // 40-testplan dùng lại nguyên trạng — fixture TESTPLAN cũ khớp luôn vì PRD
  // delta giữ nguyên AC-1-1/AC-1-2
  writeFileSync(join(dir, '40-testplan.md'), forFeature(TESTPLAN, 'doi-form'))
  assert.equal(run(['gate', 'doi-form', '40-testplan', '--root', r0]).code, 0)
  const v2 = verdictFile(r0, 'doi-form', '40-testplan', [])
  assert.equal(run(['review-record', 'doi-form', '40-testplan', '--verdict', v2, '--root', r0]).code, 0)
  assert.match(run(['advance', 'doi-form', '--root', r0]).out, /✓ doi-form: mọi stage đã xong/)
})

test('chế độ --from: artifact cũ trong _archive được băm vào inputs_hash, gate vẫn xanh', () => {
  const r0 = makeRoot()
  const oldDir = join(r0, 'features/_archive/old-widget')
  mkdirSync(oldDir, { recursive: true })
  writeFileSync(join(oldDir, '10-prd.md'), '# PRD cũ của old-widget\n')
  assert.equal(run(['init', 'doi-widget', '--type', 'change', '--from', 'old-widget', '--root', r0]).code, 0)
  const dir = join(r0, 'features/doi-widget')
  writeFileSync(join(dir, '05-impact.md'),
    IMPACT('doi-widget').replace('Nguồn: đọc từ code hiện trạng (không có feature gốc trong features/).',
      'Nguồn: PRD của feature gốc old-widget (init --from), đối chiếu thêm code hiện trạng.'))
  const r = run(['gate', 'doi-widget', '05-impact', '--root', r0])
  assert.equal(r.code, 0, r.out)
})
```

- [ ] **Step 4: Chạy test tới xanh**

Run: `node --test tests/change-pipeline.test.js`
Expected: sau Step 1-2, PASS cả 4. Nếu đỏ: đọc evidence gate in ra, sửa fixture cho thoả luật — KHÔNG sửa lib/.

- [ ] **Step 5: Cả suite + commit**

Run: `npm test && npm run lint`

```bash
git add schema/05-impact.json rubric/05-impact.md tests/change-pipeline.test.js
git commit -m "feat(change): schema + rubric 05-impact, e2e pipeline change hai chế độ --from/brownfield"
```

---

### Task 8: `pp doctor` kiểm 4 template pipeline

**Files:**
- Modify: `lib/commands/doctor.js`
- Test: `tests/cmd-doctor-templates.test.js` (mới)

**Interfaces:**
- Consumes: biến `pkgRoot` sẵn có trong `doctorCmd`, helper `line(mark, label, detail)`.
- Produces: doctor báo BAD khi một trong 4 template thiếu hoặc JSON hỏng.

- [ ] **Step 1: Viết test đỏ**

Tạo `tests/cmd-doctor-templates.test.js`:

```js
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
```

- [ ] **Step 2: Chạy test, phải ĐỎ**

Run: `node --test tests/cmd-doctor-templates.test.js`
Expected: FAIL — doctor chưa in dòng nào về template file.

- [ ] **Step 3: Sửa `lib/commands/doctor.js`**

Ngay SAU khối "── 5. Tài sản T1/T2" (sau vòng `for (const sub of [...])` và ngoài `if (root)`), thêm:

```js
  // ── 5b. Template pipeline theo loại việc ────────────────────────────────
  // pp init đọc template theo PKG_ROOT (bản cài pp), không theo --root — thiếu
  // hay hỏng JSON là init từ chối ngay cửa với type/size đó (spec pp-bugfix §8).
  for (const t of ['pipeline.S.json', 'pipeline.M.json', 'pipeline.bugfix.json', 'pipeline.change.json']) {
    const p = join(pkgRoot, 'templates', t)
    if (!existsSync(p)) {
      out += line(BAD, `templates/${t}`, 'KHÔNG tồn tại — pp init sẽ từ chối type/size này')
      bad++
      continue
    }
    try {
      JSON.parse(readFileSync(p, 'utf8'))
      out += line(OK, `templates/${t}`, 'JSON hợp lệ')
    } catch {
      out += line(BAD, `templates/${t}`, 'JSON HỎNG — pp init sẽ từ chối template này')
      bad++
    }
  }
```

Lưu ý: `pkgRoot` được khai báo ở phần 2 của hàm — khối mới nằm sau nó nên dùng được thẳng.

- [ ] **Step 4: Chạy test tới xanh, cả suite + commit**

Run: `node --test tests/cmd-doctor-templates.test.js && node --test tests/cmd-doctor.test.js && npm test && npm run lint`

```bash
git add lib/commands/doctor.js tests/cmd-doctor-templates.test.js
git commit -m "feat(doctor): kiểm 4 template pipeline tồn tại và JSON hợp lệ"
```

---

### Task 9: Slash command /pp-bugfix, /pp-change + docs

**Files:**
- Create: `commands/pp-bugfix.md`, `commands/pp-change.md`, `.claude/commands/pp-bugfix.md`, `.claude/commands/pp-change.md` (bản sao y hệt)
- Modify: `tests/docs-cites.test.js` (thêm 2 doc vào DOCS), `README.md`, `docs/specs/2026-08-18-agent-product-pipeline-design.md` (§4 thêm ghi chú)
- Test: `tests/docs-cites.test.js` (mở rộng)

**Interfaces:**
- Consumes: `pp init --type/--from` (Task 4-5); luật nạp nguồn của `commands/pp-new.md`.
- Produces: hai slash command người dùng gọi được; docs-cites gác cite chết cho chúng.

- [ ] **Step 1: Tạo `commands/pp-bugfix.md`**

```markdown
---
description: Bắt đầu một BUGFIX từ bất kỳ nguồn nào (link Jira, URL, log lỗi, text) — init pipeline bugfix + nạp nguồn + nháp brief, rồi DỪNG chờ người duyệt brief
---

Nhiệm vụ: biến $ARGUMENTS thành một feature bugfix sẵn sàng chạy `/pp` — nhưng
**dừng trước cửa diagnosis**. Brief là tiếng nói của người: chữ ký
`pp approve 05-diagnosis` sau này đặt trên nền nó. Pipeline bugfix KHÁC pipeline
feature: không có PRD — thay bằng `05-diagnosis` (tái hiện + root cause, có
human gate) → `15-fixplan` → `40-regression`. Làm đúng thứ tự sau, không bỏ
bước, không chạy quá:

1. **Đọc $ARGUMENTS, nhận diện nguồn.** Như /pp-new: link `*.atlassian.net`
   (bug ticket Jira), URL công khai, file (`.xlsx`, `.csv`, `.md`, `.txt`),
   hoặc text dán thẳng. RIÊNG bugfix: **log lỗi / stack trace dán thẳng cũng là
   một nguồn hợp lệ** — chép NGUYÊN VĂN, đừng tóm tắt hay cắt dòng "không quan
   trọng"; chính dòng đó thường là root cause.

2. **Chốt tên feature.** Khớp `^[a-z0-9][a-z0-9-]*$` (luật của `pp` — xem
   lib/commands/precond.js). Gợi ý tiền tố `fix-` cho dễ nhận diện trong
   features/. Chưa có tên thì đề xuất rồi **hỏi người dùng xác nhận**.

3. Chạy `pp init <feature> --type bugfix`. In "đã tồn tại" thì dừng và hỏi
   người dùng.

4. **Nạp từng nguồn vào `features/<feature>/refs/`** — đúng luật của /pp-new
   (một nguồn một file, dòng đầu ghi lấy từ đâu và lúc nào; Jira qua MCP
   Atlassian, Excel qua skill excel-to-md, còn lại chép nguyên văn).

5. **Nháp `00-brief.md`** theo đúng bốn mục mà scaffold đã dựng sẵn — chỉ từ
   nội dung trong `refs/`, không bịa:
   - Hiện tượng: hệ thống đang làm SAI gì (quan sát được, kèm log nếu có);
   - Mong đợi: đúng ra phải thế nào;
   - Unchanged behavior: hành vi phải GIỮ NGUYÊN sau fix — stage
     `40-regression` sẽ truy vết về từng mục ở đây, nên đừng bỏ trống;
   - Cách tái hiện (nếu biết): các bước + môi trường. Nguồn không nói thì ghi
     câu hỏi, đừng tự trả lời hộ.

6. **DỪNG LẠI Ở ĐÂY.** In nguyên văn brief ra chat, nói rõ: đọc và sửa
   `features/<feature>/00-brief.md` cho đúng ý, xong chạy `/pp <feature>` để
   pipeline bắt đầu (stage đầu là diagnosis — tái hiện được và root cause có
   bằng chứng thì mới có đường đi tiếp). Tuyệt đối không tự chạy `/pp`, không
   viết `05-diagnosis.md`, không chạy `pp gate`.

Không bao giờ tự ghi `STATE.md`, `.evidence/`, `pipeline.json` — chỉ `pp` ghi.
`refs/` và `00-brief.md` là hai chỗ duy nhất lệnh này được ghi.
```

- [ ] **Step 2: Tạo `commands/pp-change.md`**

```markdown
---
description: Bắt đầu một CHANGE REQUEST trên hành vi đã có (feature đã ship hoặc code brownfield) — tìm feature gốc, init pipeline change + nạp nguồn + nháp brief, rồi DỪNG chờ người duyệt brief
---

Nhiệm vụ: biến $ARGUMENTS thành một feature change sẵn sàng chạy `/pp` — nhưng
**dừng trước cửa impact analysis**. Pipeline change KHÁC pipeline feature:
mở đầu bằng `05-impact` (hiện trạng + thành phần bị ảnh hưởng), rồi `10-prd`
dạng DELTA (đánh dấu ADDED/MODIFIED/REMOVED, có human gate), rồi `40-testplan`.
Đổi ý GIỮA CHỪNG một feature đang chạy thì KHÔNG dùng lệnh này — sửa thẳng
artifact và để cơ chế stale re-gate (spec nền §9.3). Làm đúng thứ tự sau:

1. **Đọc $ARGUMENTS, nhận diện nguồn.** Đúng luật /pp-new: link
   `*.atlassian.net`, URL công khai, file (`.xlsx`, `.csv`, `.md`, `.txt`),
   hoặc text dán thẳng.

2. **Tìm feature gốc.** Quét tên thư mục trong `features/` và
   `features/_archive/`, và grep nội dung brief/PRD của chúng theo từ khóa
   trong nguồn. Kết quả:
   - Có ứng viên → **hỏi người dùng xác nhận** đúng feature đó rồi dùng
     `--from` ở bước 4. Không bao giờ tự đoán im lặng.
   - Không có → nói rõ với người dùng: "không tìm thấy artifact cũ — stage
     05-impact sẽ đọc code hiện trạng trong workspace thay" (dự án brownfield,
     đây là đường bình thường, không phải lỗi).

3. **Chốt tên feature mới.** Khớp `^[a-z0-9][a-z0-9-]*$` (xem
   lib/commands/precond.js); tên mô tả THAY ĐỔI, không trùng tên feature gốc.
   Hỏi người dùng xác nhận.

4. Chạy `pp init <feature> --type change --from <feature-gốc>` (bỏ `--from`
   nếu bước 2 không tìm thấy). Lệnh tự nối artifact cũ vào inputs của
   05-impact; feature gốc KHÔNG bị ghi gì — nó là lịch sử đóng băng.

5. **Nạp từng nguồn vào `features/<feature>/refs/`** — đúng luật /pp-new.

6. **Nháp `00-brief.md`** dạng DELTA trên hành vi ĐÃ CÓ, chỉ từ `refs/`:
   hôm nay hệ thống làm gì (hành vi nào, ở đâu) → sau thay đổi này khác đi ở
   đâu → vì sao cần. Có feature gốc thì nêu tên trong brief. Nguồn mâu thuẫn
   hay thiếu thì ghi câu hỏi vào cuối brief.

7. **DỪNG LẠI Ở ĐÂY.** In nguyên văn brief, nói rõ: đọc và sửa
   `features/<feature>/00-brief.md`, xong chạy `/pp <feature>`. Tuyệt đối
   không tự chạy `/pp`, không viết `05-impact.md`, không chạy `pp gate`.

Không bao giờ tự ghi `STATE.md`, `.evidence/`, `pipeline.json` — chỉ `pp` ghi.
`refs/` và `00-brief.md` là hai chỗ duy nhất lệnh này được ghi.
```

- [ ] **Step 3: Copy sang `.claude/commands/`**

```bash
cp commands/pp-bugfix.md .claude/commands/pp-bugfix.md
cp commands/pp-change.md .claude/commands/pp-change.md
```

- [ ] **Step 4: Thêm 2 doc vào docs-cites**

Trong `tests/docs-cites.test.js`, mảng `DOCS` thêm hai phần tử sau `'commands/pp-new.md'`:

```js
  'commands/pp-bugfix.md',
  'commands/pp-change.md',
```

Run: `node --test tests/docs-cites.test.js`
Expected: PASS — hai doc mới không cite path chết (`lib/commands/precond.js` tồn tại).

- [ ] **Step 5: Cập nhật `README.md`**

Sau đoạn "Bắt đầu một feature từ bất kỳ nguồn nào", thêm:

```markdown
## Bug và change request

`/pp-bugfix <nguồn>` — pipeline KHÔNG có PRD: `05-diagnosis` (tái hiện + root
cause, người duyệt) → `15-fixplan` → `40-regression` (test tái hiện bug, test
xác nhận fix, test bảo vệ hành vi không đổi).

`/pp-change <nguồn>` — thay đổi hành vi ĐÃ CÓ: `05-impact` (đọc artifact cũ
qua `--from`, hoặc đọc code hiện trạng khi dự án brownfield chưa có artifact)
→ `10-prd` dạng delta ADDED/MODIFIED/REMOVED (người duyệt) → `40-testplan`.
Đổi ý giữa chừng một feature đang chạy thì không cần lệnh này — sửa artifact,
cơ chế stale tự re-gate.

Thiết kế: [docs/specs/2026-08-20-pp-bugfix-pp-change-design.md](docs/specs/2026-08-20-pp-bugfix-pp-change-design.md)
```

- [ ] **Step 6: Ghi chú §4 spec nền**

Trong `docs/specs/2026-08-18-agent-product-pipeline-design.md`, ngay sau bảng stage map §4 (sau dòng "Chỉ **2 human gate**…"), thêm đoạn:

```markdown
*(Cập nhật 2026-08-20: bảng trên là pipeline type `feature`. Hai type mới —
`bugfix`: 05-diagnosis → 15-fixplan → 40-regression, và `change`: 05-impact →
10-prd delta → 40-testplan — xem
[2026-08-20-pp-bugfix-pp-change-design.md](2026-08-20-pp-bugfix-pp-change-design.md).)*
```

- [ ] **Step 7: Cả suite + commit**

Run: `npm test && npm run lint`
Expected: xanh toàn bộ (docs-cites gác hai doc mới).

```bash
git add commands/pp-bugfix.md commands/pp-change.md .claude/commands/pp-bugfix.md .claude/commands/pp-change.md tests/docs-cites.test.js README.md docs/specs/2026-08-18-agent-product-pipeline-design.md
git commit -m "docs(commands): /pp-bugfix và /pp-change — init theo type, nạp nguồn, dừng chờ duyệt brief"
```

---

## Ánh xạ spec → task (self-review đã chạy)

| Spec | Task |
|---|---|
| §3.1 `--type`, brief scaffold, template mang `type`, S/M thêm type, type lạ exit 2, template hỏng exit 2 | 1, 4 |
| §3.2 `--from` (resolve 2 nơi, tiêm inputs, exit 2 các nhánh, không ghi feature cũ) | 5 |
| §3.3 schema override + reads_workspace | 1, 2, 3 |
| §4 pipeline bugfix (template, schema, rubric, human gate, luật sắt qua gate sẵn có) | 4, 6 |
| §5 pipeline change (template, impact 2 chế độ, PRD delta, 40-testplan nguyên trạng) | 4, 7 |
| §6 slash commands | 9 |
| §7 test list (init type/from, shape template qua e2e, stage order qua e2e, registry override, schema superset, e2e gate đỏ/xanh, docs-cites) | 2, 4, 5, 6, 7, 9 |
| §8 error handling (type lạ, from sai, from+type sai, template hỏng, doctor) | 4, 5, 8 |
| §9 non-goals — không có task nào đụng 60-dev/90-archive/hotfix/sync ngược | — |
```
