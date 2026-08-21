# Agent Product Pipeline — Design Spec

- **Ngày:** 2026-08-18
- **Tác giả:** Edward Ngo (minh.ngo@monstar-lab.com) + Claude
- **Trạng thái:** Design đã duyệt qua 4 section — chờ review trước khi lập implementation plan
- **Phạm vi:** Hệ điều phối agent cho toàn vòng đời sản phẩm của một fullstack dev làm full role

---

## 1. Bối cảnh và vấn đề

### 1.1 Hiện trạng

Máy đang có **ba bộ khung agent chồng nhau**, cùng nạp vào context và cho chỉ thị mâu thuẫn:

| Bộ | Vị trí | Quy mô | Ghi chú |
|---|---|---|---|
| AIDLC | `~/.claude/agents/aidlc-*.md` | 9 agent | Pipeline SDLC + 4 human gate, có `aidlc-orchestrator` (LLM quyết luồng) |
| EM-Team | `~/.claude/em-team/` | 29 agent, 30 workflow, 8 protocol, ~20 skill pack | Delegation qua tmux + message queue |
| orchestrator | `~/CLAUDE.md` + `orchestrator` 0.7.4 | Leader / BE-Worker / FE-Worker / Exec | **Đang chạy thật** trên `~/Documents/workspace` |

Ngoài ra:

- **`dev-ba-kit` v2.5.0** (`github.com/nv-minh/dev-ba-kit`, do chính người dùng viết) — **63 skill** đã phủ gần hết vai trò phi-dev.
- `my-team-plugin` — skeleton 1 agent.
- `superpowers` — vừa cài, dùng cho brainstorming / writing-plans.

### 1.2 Kết luận chẩn đoán

**Không thiếu agent. Thiếu nhạc trưởng.**

Đối chiếu stage cần có với `dev-ba-kit`:

| Stage | Trạng thái | Skill sẵn có |
|---|---|---|
| PM/BA | đã có | `brainstorm, urd, brd, prd, prd-epic, srs, usecase, userstory, ac, user-flow, roadmap, gap` |
| UI/UX (optional) | đã có | `wireframe-ascii, wireframe-html, prototype-html, figma, journey` |
| Contract/API | đã có, rất mạnh | `api-design, api-doc, api-map, api-assess, api-checklist, api-readiness, api-test` |
| QA | đã có | `test-cases, test-checklist, api-test` |
| Bàn giao | đã có | `jira, confluence, sync-confluence, export, cr, dashboard` |
| Security | **thiếu** | — |
| DevOps / Analytics | **thiếu** | — |
| **Điều phối + gate** | **thiếu — lỗ hổng chính** | — |

Người dùng đang sở hữu hộp đồ nghề 63 món và phải **gọi tay từng món** — đúng mô hình "prompt từng cái một" cần thoát khỏi.

### 1.3 Điểm đau chất lượng (quan trọng ngang điểm đau điều phối)

- **PRD**: sơ sài, không rõ ràng, không phát hiện được vấn đề tiềm ẩn
- **UI/UX**: không phân tích kỹ
- **QA**: testcase sai format chuẩn, hời hợt, thiếu edge case
- **Dev**: code không sạch, ảo giác, xử lý phức tạp hơn thực tế, over-engineer

Năm gốc rễ chung:

| Gốc | Hệ quả |
|---|---|
| Input quá thưa | brief một dòng → PRD generic, model lấp chỗ trống bằng nội dung sáo rỗng |
| Không có áp lực đối kháng | mọi output dừng ở chất lượng bản nháp đầu |
| Không neo vào thực tế | viết mà không đọc code thật → ảo giác + tưởng tượng độ phức tạp không có |
| Không có định nghĩa "tốt" | model tối ưu cho *trông có vẻ đầy đủ* |
| Không nhớ lỗi cũ | lặp lại sai lầm cũ |

Over-engineer và test hời hợt là **cùng một hành vi**: khi không chắc, model sản xuất *nhiều* thay vì *đúng*.

---

## 2. Nguyên tắc thiết kế

1. **Control flow tất định.** Quyết định "stage nào chạy tiếp" thuộc về shell script đọc file state, **không** thuộc về một LLM orchestrator. Đây là mắt xích yếu của cả AIDLC lẫn EM-Team.
2. **Hoàn thành là dữ kiện, không phải lời khai.** Không thực thể LLM nào có quyền ghi trạng thái `done`.
3. **Artifact là ranh giới nén context.** Mỗi stage khai báo `inputs:` tường minh, chạy trong subagent mới, chỉ đọc đúng file đã khai báo.
4. **Không đụng lớp toolbox.** `dev-ba-kit` và `orchestrator` là bất khả xâm phạm; mọi thích ứng nằm ở lớp conductor.
5. **Không dựng swarm cho coding.** Theo Anthropic: multi-agent tốn ~15x token và *kém* hiệu quả với việc phụ thuộc chặt chẽ — mà coding chính là loại đó.
6. **Simplicity (kế thừa `ORCHESTRATOR_ORCHESTRATOR.md`).** Thay đổi nhỏ nhất thoả mãn yêu cầu + test. Nghi thức nặng là rủi ro, không phải chất lượng.

---

## 3. Kiến trúc ba lớp

```
┌─ Lớp 3: CONDUCTOR (xây mới, nhỏ) ───────────────────┐
│  /pp advance <feature>       ← lệnh duy nhất gõ tay │
│  bin/pp        shell, TẤT ĐỊNH — không phải LLM     │
│  bin/pp-gate   kiểm DoD, trả exit code              │
└─────────────────────┬───────────────────────────────┘
                      │ đọc/ghi
┌─ Lớp 2: BLACKBOARD (file trong git) ────────────────┐
│  product-repo/features/<feature>/               │
│    pipeline.json · STATE.md · .evidence/            │
│    00-brief 10-prd 20-ux 30-contract                │
│    40-testplan 50-security 60-handoff 70-ops        │
└─────────────────────┬───────────────────────────────┘
                      │ được sinh ra bởi
┌─ Lớp 1: TOOLBOX (đã có, KHÔNG sửa) ─────────────────┐
│  dev-ba-kit 63 skills    +    orchestrator (stage dev)     │
└─────────────────────────────────────────────────────┘
```

### 3.1 Vòng chạy `/pp advance <feature>`

1. `pp status` đọc `pipeline.json` + `STATE.md` → in ra **stage kế tiếp và lý do** (tất định)
2. Claude nạp skill của stage đó từ `dev-ba-kit`, đọc **đúng** artifact khai báo trong `inputs:`
3. Skill ghi artifact vào blackboard
4. `pp gate <stage>` chạy T1 → (nếu xanh) T2 → ghi `.evidence/<stage>.<tier>.log` (mỗi tier một file riêng, để T2 không ghi đè exit code của T1)
5. Xanh → `STATE.md` ghi `done`. Đỏ → trả lỗi cho Claude sửa, **trần 3 vòng**, rồi `blocked` + notification

---

## 4. Stage map

| # | Stage | Mặc định | Chạy bằng | Artifact | Human gate |
|---|---|---|---|---|---|
| 00 | brief | bắt buộc | người viết, hoặc `/brainstorm` | `00-brief.md` | — |
| 10 | requirement | on | `/prd-epic` → `/userstory` → `/ac` | `10-questions.md`, `10-prd.md` | **có** |
| 20 | ux | **off** (toggle) | `/user-flow` + `/wireframe-ascii` (+`/figma`) | `20-ux.md` | — |
| 30 | contract | on | `/api-design` + `/api-doc` | `30-contract.md` | **có** |
| 40 | testplan | on | `/test-cases` + `/test-checklist` | `40-testplan.md` | — |
| 50 | security | on | **skill cần xây** | `50-security.md` | — |
| 60 | dev | on | **orchestrator** — pipeline chỉ bàn giao | `60-handoff.md` + code + PR | — |
| 70 | ops | off | **skill cần xây** | `70-ops.md` | — |
| 90 | archive | on | `pp archive` *(lệnh chưa implement — test plan đã có ở features/archive-command)* | `_archive/…` | — |

Chỉ **2 human gate**: sau `10-prd` (sai ở đây hỏng toàn bộ hạ nguồn) và sau `30-contract` (đổi contract sau khi BE đã code là đắt nhất). AIDLC dùng 4 gate — quá nhiều cho người làm một mình.

*(Cập nhật 2026-08-20: bảng trên là pipeline type `feature`. Hai type mới —
`bugfix`: 05-diagnosis → 15-fixplan → 40-regression, và `change`: 05-impact →
10-prd delta → 40-testplan — xem
[2026-08-20-pp-bugfix-pp-change-design.md](2026-08-20-pp-bugfix-pp-change-design.md).)*

### 4.1 `pipeline.json`

```yaml
feature: feedback-collector
size: M                                  # pp size gợi ý; người dùng override được
stages:
  10-prd:
    enabled: true
    skills:  [prd-epic, userstory, ac]
    inputs:  [00-brief.md, ../../constitution.md]
    outputs: [10-questions.md, 10-prd.md]
    gate:    [t1, t2]
    human:   true
  20-ux:
    enabled: false                       # ← toggle UI/UX
    skills:  [user-flow, wireframe-ascii]
    inputs:  [10-prd.md]
    outputs: [20-ux.md]
    gate:    [t1]
  30-contract:
    enabled: true
    skills:  [api-design, api-doc]
    inputs:  [10-prd.md, "20-ux.md?"]    # ? = optional
    outputs: [30-contract.md]
    gate:    [t1]
    human:   true
  40-testplan:
    enabled: true
    skills:  [test-cases, test-checklist]
    inputs:  [10-prd.md, 30-contract.md]
    outputs: [40-testplan.md]
    gate:    [t1, t2]
  50-security:
    enabled: true
    inputs:  [10-prd.md, 30-contract.md]
    outputs: [50-security.md]
    gate:    [t1, t2]
  60-dev:
    enabled: true
    handoff: orchestrator
    inputs:  [30-contract.md, 40-testplan.md, 50-security.md]
    outputs: [60-handoff.md]
    gate:    [t1, t2]
    budget:  {new_files: 6, changed_lines: 400}
  70-ops:     {enabled: false}
  90-archive: {enabled: true}
```

`inputs:` không phải trang trí — nó là **ranh giới đọc** của subagent.

---

## 5. Gate ba tầng

| Tầng | Ai kiểm | Tính chất | Quyền chặn |
|---|---|---|---|
| **T1 — script** | `pp gate` (shell) | Tất định, ~50ms, miễn phí | **Có** — đỏ là dừng |
| **T2 — reviewer** | subagent đối kháng + rubric | Có thể sai | Chỉ chặn `severity: high` |
| **T3 — người** | người dùng | Đúng 2 chỗ | Có |

T1 đỏ → **không tốn token nào** cho T2.

### 5.1 Luật T1

**Chung mọi artifact:** file tồn tại & khác rỗng · frontmatter hợp lệ (`feature, stage, updated, source`) · đủ heading bắt buộc · **không còn placeholder** (`TBD | TODO | ??? | XXX | FIXME | {{…}}`) · **mọi đường dẫn được cite phải tồn tại thật** (`test -f`).

**`10-prd`**
- Mỗi user story có ID `US-<n>`; mỗi story có ≥1 AC id `AC-<n>-<m>`
- **AC bắt buộc viết EARS**, đúng một `SHALL` mỗi AC (hai `SHALL` = AC bị gộp, phải tách):
  - `WHEN <sự kiện> THE SYSTEM SHALL <hành vi>`
  - `WHILE <trạng thái> THE SYSTEM SHALL <hành vi>`
  - `IF <điều kiện> THE SYSTEM SHALL <hành vi>`
  - `THE SYSTEM SHALL <năng lực>` (ubiquitous)
  - `WHEN … WHILE … IF … THE SYSTEM SHALL …` (kết hợp)
- Bắt buộc có `## Out of scope`
- Không có AC mồ côi
- **Checklist rủi ro** phải được trả lời hết, "không áp dụng" phải kèm lý do:
  migrate dữ liệu cũ · ai **không** được phép · thao tác đồng thời · mạng lỗi/offline ·
  giới hạn kích thước & phân trang · i18n/timezone · hiệu năng khi dữ liệu lớn · rollback

**`20-ux`** (nếu bật)
- Mỗi flow tham chiếu ≥1 `US-id` có thật
- Mỗi màn hình khai báo đủ **3 trạng thái: loading / empty / error**

**`30-contract`**
- Mỗi endpoint đủ: method, path, request schema, response schema, danh sách mã lỗi
- Mỗi endpoint trỏ về ≥1 `US-id`
- **Reverse coverage:** không US nào cần API mà thiếu endpoint
- `--live`: diff với `/docs/api/swagger.json` → phát hiện **contract drift**

**`40-testplan`** — gate đáng giá nhất
- **Traceability 100%**: mọi `AC-*` trong `10-prd` phải xuất hiện; thiếu → in ra đúng AC nào
- Mỗi TC đủ field: `id · ac_ref · precondition · steps · expected · type · priority`
- **Ép tỉ lệ loại test**: mỗi AC có ≥1 `positive` **và** ≥1 `negative`; mỗi field số/chuỗi/ngày có ≥1 `boundary`; mỗi endpoint có phân quyền có ≥1 `permission`
- **Bảng sinh edge case bắt buộc** cho mỗi input field, ô trống là đỏ:
  `null · rỗng · vượt max length · unicode/emoji · số âm · 0 · số rất lớn · sai định dạng · trùng lặp · gọi đồng thời · sai quyền`

**`50-security`**
- Mỗi endpoint trong `30-contract` **phải có dòng phân quyền** — thiếu là đỏ
- Mỗi endpoint nhận input phải có rule validate
- Checklist: authz · input validation · secrets · rate limit · data exposure · logging — mỗi mục buộc có kết luận
- Không có secret dạng literal

**`60-dev`** — `yarn lint && yarn build && yarn test` ở repo bị đổi + contract drift + **change budget** (vượt trần file/dòng → đỏ, phải giải trình)

**`70-ops`** (nếu bật) — mỗi endpoint ghi log/metric gì · có rollback plan · analytics event có tên + schema

### 5.2 Định dạng để script kiểm được

Bọc phần cần kiểm bằng **XML-style tag** trong markdown — người vẫn đọc được, script hết giòn:

```markdown
<ac id="AC-3-2" story="US-3">
WHEN người dùng submit form trống THE SYSTEM SHALL hiển thị lỗi trên từng field bắt buộc
</ac>
```

### 5.3 Thi hành — 3 điểm chặn

1. **`pp gate <stage>`** — chạy tay hoặc do `/pp advance` gọi
2. **`Stop` hook** — chặn Claude kết thúc lượt khi stage `in_progress` mà gate chưa xanh *(cơ chế lấy từ plugin `ralph-wiggum` chính thức, nhưng điều kiện dừng đổi từ chuỗi văn bản sang **exit code**)*
3. **`PreToolUse` hook** — chặn ghi artifact của stage đang tắt/chưa tới lượt; **chặn mọi agent ghi `STATE.md` và `.evidence/`**

Điểm 3 không được bỏ: nếu agent ghi được `STATE.md`, nó sẽ tự tuyên bố `done` và hệ thống sụp thành diễn kịch.

### 5.4 Ví dụ output gate

```
$ pp gate 40-testplan --feature feedback-collector
✗ FAIL  40-testplan  (2 lỗi, attempt 1/3)

  [traceability] 2/9 AC chưa có test case:
      AC-3-2  "WHEN người dùng submit form trống THE SYSTEM SHALL …"
      AC-5-1  "WHEN >10 request/phút THE SYSTEM SHALL trả 429"
  [negative-case] POST /feedback: không có case lỗi

  exit 1
```

---

## 6. Ép chất lượng đầu ra — 6 trụ cột

Gate T1 chỉ kiểm *có đủ mục không*, không kiểm *có sâu không*. Sáu trụ cột dưới đây trị trực tiếp các điểm đau ở §1.3.

### Trụ cột 1 — T2 reviewer đối kháng

- `rubric/<stage>.md`: 8–12 tiêu chí, mỗi tiêu chí ghi rõ **đạt / trượt**
- Reviewer là **subagent riêng, không thấy quá trình viết** — chỉ thấy artifact + rubric + constitution
- Prompt **mặc định REJECT**: nhiệm vụ là *tìm lỗi*; mỗi tiêu chí phải **trích dẫn bằng chứng cụ thể** trong artifact
- Output có cấu trúc: `{criterion, verdict, severity, evidence, fix}`
- `high` → chặn · `medium` → ghi thành open question, không chặn
- Chỉ chạy ở 4 stage: `10-prd`, `40-testplan`, `50-security`, `60-dev` (đọc **diff**)

### Trụ cột 2 — Ép hỏi trước khi viết (hai đường hợp lệ)

`10-prd` **không được ghi `10-prd.md`** cho tới khi `10-questions.md` hợp lệ theo MỘT trong hai đường: **(a)** ≥8 câu hỏi **và tất cả đã có câu trả lời**, hoặc **(b)** — khi agent tự đánh giá `00-brief.md` + `refs/` là đủ rõ — khối `## Tự đánh giá độ rõ` ghi `Lý do đủ rõ:` + `Giả định đã xác minh:` và chỉ còn tối đa `clearQuestionsMax` (2) câu verify (mọi câu hỏi vẫn phải có `A:` khác rỗng). T1 chỉ kiểm cấu trúc của khối; tính trung thực của lời khai "đủ rõ" do T2 (rubric #7) và human gate giữ. PreToolUse chặn write; gate kiểm mọi câu hỏi có dòng `A:` khác rỗng.

### Trụ cột 3 — Neo vào code thật (gate chống ảo giác rẻ nhất)

Mọi artifact khi nhắc file/endpoint/entity phải **cite đường dẫn thật**; T1 chạy `test -f`. Ép agent thực sự đọc repo (`scan-project`, `code-flow`, `api-map`) thay vì tưởng tượng — chữa luôn bệnh "handle phức tạp hơn thực tế".

### Trụ cột 4 — Testcase: biến "kỹ" thành đếm được

Xem §5.1 `40-testplan`. Thêm phép thử T2 riêng: *"nếu implement sai theo cách X thì test nào bắt được?"* — không test nào bắt → thiếu case.

### Trụ cột 5 — Chống over-engineer bằng ngân sách

| Cơ chế | Cách làm |
|---|---|
| **Change budget** | Khai báo trước trần file mới / dòng đổi. Vượt → đỏ, phải giải trình bằng chữ |
| **Test có trước code** | `40-testplan` đứng trước `60-dev`; code chỉ cần làm test xanh |
| **Simplicity reviewer** | Lens riêng đọc **diff**: abstraction thừa, lớp không cần, config vô dụng, generic hoá sớm, dependency mới |
| **`yarn build`** | Typecheck — bộ chống ảo giác tốt nhất đã có sẵn |

### Trụ cột 6 — Vòng học từ lỗi

Mỗi lần gate đỏ, hoặc mỗi lần người dùng phải sửa tay → một dòng vào `lessons/<stage>.md`. File này được **inject vào prompt của chính stage đó lần sau** (cơ chế `inject-standards` của Agent OS).

### 6.1 Giới hạn thành thật

**Chất lượng PRD bị chặn trên bởi chất lượng `00-brief` và lời khai "đủ rõ" của agent.** Từ bản 2026-08-21, agent tự đánh giá độ rõ của brief + refs: đủ rõ thì khai khối tự đánh giá (lý do + giả định đã xác minh) và chỉ hỏi tối đa 2 câu verify. Đòn bẩy của người chuyển sang: trả lời thực chất những câu còn được hỏi, và từ chối ở human gate khi lời khai không đáng tin. Hệ thống ép được nó không bỏ trống, bị phản biện, neo vào code thật — nhưng nếu brief sơ sài thì đầu ra vẫn sơ sài.

Hai việc không tự động hoá được, và không nên cố: **phán xét lời khai đủ rõ ở stage 10**, và **duyệt 2 human gate**.

---

## 7. Luồng dữ liệu

### 7.1 Artifact sống ở đâu

Layout A: root `~/Documents/workspace` **không phải git repo**; một feature chạm cả hai repo. Artifact không thuộc repo nào.

**Quyết định: thêm repo thứ ba `product-repo/`.**

```
~/Documents/<workspace>/          ← container, không phải repo
├── backend-repo/                   ← repo, code BE
├── web-repo/                       ← repo, code FE
└── product-repo/                   ← repo MỚI, chỉ chứa artifact
    ├── constitution.md
    ├── CHANGELOG.md
    ├── lessons/
    ├── rubric/
    ├── schema/
    └── features/
        ├── feedback-collector/         ← blackboard của MỘT feature:
        │     pipeline.json · STATE.md · artifacts (00-brief.md …)
        │     .evidence/ · audit.jsonl · .review/ · .usage/
        └── _archive/
```

*Phương án gọn hơn nếu 3 repo là nhiều:* đặt trong `backend-repo/docs/product/`, FE tham chiếu tương đối. Chấp nhận được, hơi lệch về khái niệm.

### 7.2 `constitution.md`

Bộ nguyên tắc bất di bất dịch mà **mọi artifact kế thừa** *(lấy từ GitHub Spec Kit)*: quy tắc Simplicity/YAGNI trong `ORCHESTRATOR_ORCHESTRATOR.md`, convention NestJS/React, boundary BE↔FE, quy tắc contract-first. T2 reviewer kiểm artifact **ngược lại constitution**.

### 7.3 `STATE.md` — chỉ `pp` được ghi

```markdown
<!-- GENERATED BY pp — DO NOT EDIT (PreToolUse hook chặn agent ghi file này) -->
feature: feedback-collector
updated: 2026-08-18T22:41:03+07:00
current: 40-testplan
stages:
  10-prd:      {status: done,    attempts: 2, gate: pass, human: approved,
                inputs_hash: a3f9c1, evidence: .evidence/10-prd.t1.log}
  20-ux:       {status: skipped, reason: disabled}
  30-contract: {status: done,    attempts: 1, gate: pass, human: approved,
                inputs_hash: 77b204, evidence: .evidence/30-contract.t1.log}
  40-testplan: {status: failed,  attempts: 1, gate: fail,
                evidence: .evidence/40-testplan.t1.log}
  50-security: {status: pending}
  60-dev:      {status: pending}
  90-archive:  {status: pending}
```

### 7.4 Evidence file

```
# .evidence/40-testplan.t1.log
[2026-08-18T22:40:51+07:00]  pp gate 40-testplan --tier t1
$ pp-check placeholders 40-testplan.md
Exit status: 0
$ pp-check schema 40-testplan.md
Exit status: 0
$ pp-check traceability 10-prd.md 40-testplan.md
  missing: AC-3-2, AC-5-1
Exit status: 1
RESULT: FAIL (t1) — attempt 1/3
```

Luật: quét evidence, gặp **bất kỳ `Exit status:` khác 0** → stage không thể `done`.

Quét là quét **mọi log tier có thật trong `.evidence/`**, không phải chỉ những tier được liệt kê trong `gate` — một `gate: ["t2"]` viết tay không được biến `.evidence/<stage>.t1.log` đang đỏ thành thứ vô hình. Và câu hỏi này được **hỏi lại mỗi lần đọc** (`pp status`, `pp advance`, `pp approve`, `pp report`), không chỉ lúc ghi: `done` là kết luận rút từ evidence, không phải một cờ trong `STATE.md`.

### 7.5 Luật vô hiệu hoá ngược dòng

`pp` lưu `inputs_hash` mỗi stage. Mỗi lần chạy băm lại toàn bộ input đã khai báo; lệch hash → **mọi stage hạ nguồn chuyển `stale`**, phải chạy gate lại (không viết lại từ đầu). **Human gate đã duyệt cũng bị thu hồi nếu input đổi.**

Song song với nó là luật vô hiệu hoá **tại chỗ**: mỗi kết quả tier lưu thêm `artifact_hash` — hash của chính artifact (output cuối của stage) tại thời điểm tier đó chấm. **Một kết quả tier chỉ có giá trị với đúng bản artifact nó đã chấm**; artifact bị sửa sau đó → tier ấy hết hiệu lực, phải chạy lại (T2 không được thừa hưởng phán quyết viết cho bản trước). Kết quả tier **không có** `artifact_hash` (state do bản `pp` cũ ghi) cũng tính là chưa qua — nguồn gốc không rõ thì kiểm lại, y như `inputs_hash` vắng mặt.

Ngoại lệ duy nhất, có chủ đích: stage `overridden` được hoàn tất bằng quyết định tay của con người, nên không bị đòi evidence / `inputs_hash` / `artifact_hash`. Bỏ ngoại lệ này là đưa pipeline vào vòng re-gate vô hạn.

### 7.6 Đường đi một feature

```
pp init feedback-collector
   └─→ folder + pipeline.json (theo size) + 00-brief.md rỗng

NGƯỜI viết 00-brief.md   (3–10 dòng, viết dạng DELTA so với hiện trạng)

/pp advance ──┐
   pp status → "kế tiếp: 10-prd, thiếu 10-questions.md"
   subagent(inputs: brief + constitution) → 10-questions.md:
     8 câu đã trả lời, HOẶC khối "## Tự đánh giá độ rõ" + ≤2 câu verify
   ⛔ PreToolUse chặn ghi 10-prd.md  →  DỪNG, chờ người

NGƯỜI trả lời các câu còn mở trong 10-questions.md

/pp advance ──┐
   subagent MỚI(inputs: brief + questions + constitution)
     → /prd-epic → /userstory → /ac  → 10-prd.md
   pp gate 10-prd:  T1 → T2 → đỏ thì attempt++ , trần 3 → blocked + notification
   xanh → 🚦 HUMAN GATE #1 → `pp approve 10-prd`

20-ux: enabled=false → skipped
30-contract  → gate → 🚦 HUMAN GATE #2
40-testplan  → traceability 100% AC → T2 mutation check
50-security  → mọi endpoint có phân quyền + validate rule
60-dev  ────→ BÀN GIAO CHO ORCHESTRATOR (§8)
90-archive   → _archive/ + CHANGELOG.md + lessons/
```

### 7.7 Bảng phân quyền ghi (thi hành bằng PreToolUse hook)

| Đối tượng | `STATE.md` `.evidence/` `audit.jsonl` `.review/` `.usage/` | artifact stage hiện tại | artifact stage khác | code repo |
|---|---|---|---|---|
| `pp` (script) | **ghi** | — | — | — |
| Stage subagent | ⛔ | ghi | ⛔ | ⛔ |
| Reviewer subagent | ⛔ | ⛔ (chỉ đọc) | ⛔ | ⛔ đọc |
| orchestrator BE/FE Worker | ⛔ | ⛔ | ⛔ | ghi (repo của mình) |
| Người dùng | ghi (`pp approve`) | ghi | ghi | ghi |

Dòng đầu giữ cả hệ thống đứng vững: **không thực thể LLM nào có quyền ghi trạng thái hoàn thành.** Ba path bằng chứng mới (`audit.jsonl`, `.review/`, `.usage/`) nằm cùng cột với `STATE.md`/`.evidence/` vì cùng lý do: agent sửa tay evidence là làm giả bằng chứng. Ngoại lệ duy nhất: file `.review-<stage>.json` ở **gốc** feature là **inbox** conductor nộp verdict thô cho `pp` — agent được ghi (đó là bàn giao dữ liệu, `pp` mới là bên ghi state); `.review/` (dir) là bản lưu vĩnh viễn do `pp` tạo ra từ inbox đó.

---

## 8. Mối nối orchestrator

**`pp` sở hữu artifact và gate. `orchestrator` sở hữu tiến trình và code.** `pp` không bao giờ gọi `git commit`; `orchestrator` không bao giờ ghi vào `product-repo/`.

Stage `60-dev` không chạy skill. Nó sinh `60-handoff.md` — bản tóm tắt **tự chứa** để Worker không cần đọc cả blackboard:

```
60-handoff.md
├─ Scope BE   : endpoint từ 30-contract + rule phân quyền/validate từ 50-security
├─ Scope FE   : màn hình & luồng từ 10-prd (+ 20-ux nếu bật)
├─ Phải xanh  : danh sách TC-id từ 40-testplan
├─ Budget     : ≤6 file mới, ≤400 dòng đổi
└─ DoD        : yarn lint && yarn build && yarn test
```

Chạy theo đúng contract flow đã có trong `ORCHESTRATOR_ORCHESTRATOR.md`:

```
pp handoff 60-dev
 ├─ orchestrator worktree create --cwd backend-repo --branch feature/<name> …
 ├─ orchestrator agent start BE-Worker … -- <phần BE của 60-handoff.md>
 ├─ pp gate 60-dev --side be     → yarn lint/build/test  +  contract drift
 ├─ merge BE trước  (API producer)
 ├─ orchestrator agent start FE-Worker … (chạy yarn sdk:generate trước)
 ├─ pp gate 60-dev --side fe
 └─ pp gate 60-dev --tier t2     → simplicity reviewer đọc DIFF
```

**Contract drift là mối nối hai chiều.** Sau khi BE chạy, `pp gate 30-contract --live` fetch `/docs/api/swagger.json` và diff với `30-contract.md`. Lệch → đỏ: hoặc BE sai, hoặc contract phải cập nhật (khi đó §7.5 tự đánh `40-testplan`, `50-security` thành `stale`). Không có đường nào để sai lệch trôi qua im lặng.

Vòng lặp có trần và thông báo tái dùng nguyên cơ chế `ORCHESTRATOR_ORCHESTRATOR.md`: `orchestrator pane read` → `orchestrator agent send` → tối đa 3 → `orchestrator notification show`.

---

## 9. Xử lý lỗi và bảo trì

### 9.1 Tập trạng thái

| Trạng thái | Nghĩa | Lối ra |
|---|---|---|
| `pending` | chưa tới lượt | `pp advance` |
| `in_progress` | subagent đang chạy | Stop hook giữ |
| `failed` | gate đỏ, `attempts < 3` | tự sửa vòng tiếp |
| `blocked` | `attempts = 3` | `pp unblock <stage>` — bắt buộc kèm lý do → ghi `lessons/` |
| `stale` | input thượng nguồn đã đổi | chạy lại gate |
| `skipped` | tắt trong `pipeline.json` | bật lại rồi `pp advance` |
| `done` | gate xanh + evidence sạch | — |

### 9.2 Cửa thoát hiểm (bắt buộc phải có)

```
pp override 40-testplan --reason "gate traceability nhận nhầm AC-5-1 do format bảng"
```

Cho qua gate đỏ, **bắt buộc lý do bằng chữ**, ghi vào evidence + `STATE` với cờ `overridden: true`, và mọi override hiện trong `pp report`.

Không phải cửa sau mà là **cửa có ghi sổ**. Lý do bắt buộc có: gate sẽ có lúc chặn oan; không thoát được thì người dùng sẽ bỏ cả hệ thống. Và **một gate bị override ≥3 lần nghĩa là gate đó sai — sửa luật, không sửa người.**

### 9.3 Đổi ý giữa chừng

**(a) Đổi requirement khi chưa tới dev** — rẻ. Sửa `10-prd.md`, §7.5 tự đánh `stale`, chạy lại gate.

**(b) Đổi contract khi BE đang code** — đắt nhất, quy trình cứng:

```
orchestrator agent send BE-Worker "DỪNG, contract đang đổi"
sửa 30-contract.md → pp gate 30-contract → 🚦 human gate lại
pp handoff 60-dev --regen          # sinh 60-handoff.md MỚI
orchestrator agent start BE-Worker … -- <handoff mới>
```

Tuyệt đối **không** báo thay đổi qua chat rồi để worker tự điều chỉnh — nó đã có context cũ và sẽ trộn hai phiên bản. Khởi động lại rẻ hơn gỡ rối.

**(c) Giữa chừng phát hiện feature quá to** — tách feature mới, chuyển một phần AC sang, đánh dấu feature gốc `superseded`. Không cố nhét.

### 9.4 Khi bản thân hệ thống hỏng

| Triệu chứng | Ngưỡng báo động | Xử lý |
|---|---|---|
| Gate chặn oan | 1 gate bị override ≥3 lần | sửa luật gate |
| Reviewer quá khắt | cùng stage >3 vòng ở nhiều feature | hạ severity threshold / viết lại rubric |
| Schema lệch dev-ba-kit | T1 đỏ dù artifact thật sự tốt | thêm `pp normalize`, **không** sửa dev-ba-kit |
| Blackboard phình | `features/` >15 thư mục sống | `pp archive` *(chưa implement — tạm chuyển tay vào features/_archive/)* |
| `lessons/` phình | 1 file >20 dòng | gộp lại |
| **Nghi thức quá nặng** | phần phi-dev 1 feature **>30 phút** | **cắt stage** |

`pp report` in cho mỗi feature: số vòng từng stage, số override, token, thời gian. *(Đã làm: token là số thô tổng hợp từ `.usage/entries.jsonl` do `pp usage-sync` sinh; "thời gian" là KHOẢNG first→last ts trong `audit.jsonl`, không phải công sức — xem §9.5.)*

### 9.5 Kiểm toán, token, hội thoại (storage-only)

Phase này chỉ **lưu dữ liệu có cấu trúc** để làm evidence cải tiến (chi phí, chất lượng, debug, tuân thủ) — không UI/dashboard; phân tích sau bằng script. Ba mảnh, tất cả chỉ `pp` được ghi (guard chặn, §7.7):

**(a) Sổ kiểm toán `features/<f>/audit.jsonl`** — append-only, một dòng JSON mỗi lần một lệnh pp chạm feature: `{ts: ISO đầy đủ, v: 1, actor: "human"|"pp", event, feature, stage?, ok?, reason?, details?}`. `actor` là **phân loại theo lớp lệnh** (init/approve/override/unblock = human; còn lại = pp) — pp không thể xác minh danh tính thật. Ghi là best-effort: lỗi ghi audit không đổi exit code của lệnh (exit code là dữ kiện về gate). `lessons/` giữ nguyên vai trò sổ tay của người; audit chỉ mirror.

**(b) Archive hội thoại reviewer `features/<f>/.review/<stage>.<seq>.json`** — mỗi verdict được lưu vĩnh viễn: nguyên văn verdict + `verdict_sha` + `prompt_sha` (hash của prompt dựng lại bằng cùng `buildReviewPrompt` — hash lệch = rubric/artifact đã đổi giữa lúc hỏi và lúc chấm). `seq` đơn điệu **tách khỏi** `attempts` (attempts reset khi done; dùng lại sẽ ghi đè lịch sử sau chu kỳ re-gate).

**(c) Token thật `features/<f>/.usage/entries.jsonl`** — `pp usage-sync <feature> [--since <iso>] [--transcripts DIR]` khai thác transcript Claude Code (`~/.claude/projects/<munged-cwd>/*.jsonl`; munge = mọi ký tự không alphanumeric thành `-`). Luật:
- **Dedup theo `(session, message.id)` là bắt buộc** — một API response sinh nhiều dòng JSONL (mỗi content block một dòng) với usage giống hệt nhau; không dedup thì token thổi phồng ~65% (đo thực tế). LLM **không được tự khai usage** trong verdict — evidence không nhận lời khai.
- **Attribution là heuristic**: cửa sổ thời gian dựng từ event `dispatch`/`review-prompt` trong audit.jsonl ([ts, sự kiện kế tiếp), cap 2h) → gán stage; ngoài cửa sổ thì fallback dòng thô có nhắc `features/<f>` → `attrib: "mention"`, không rõ stage. Mỗi entry lưu `attrib`/`stage`/`ts` thô để script sau tái gán mà không khai thác lại.
- **Idempotent**: id đã có trong file thì bỏ — chạy hai lần thêm 0 mục.
- Chỉ lưu **số + metadata** (model, session, sidechain), không copy nội dung hội thoại (riêng tư + kích thước; transcript gốc vẫn ở ~/.claude). Thiếu thư mục transcript = thiếu dữ liệu, exit 0.

---

## 10. Đường vào thực tế

### 10.1 Dọn 3 framework cũ — move, không delete

```
Bước 0  grep toàn bộ ~/.claude tìm tham chiếu tới em-team / aidlc / my-team-plugin
        (hook, script, statusline, orchestrator config đều có thể đang trỏ vào)
Bước 1  mkdir ~/.claude/_archive/2026-08-18/
        MOVE:  em-team/  ·  agents/aidlc-*.md  ·  my-team-plugin/
Bước 2  session mới → /context → xác nhận không còn nạp
Bước 3  GIỮ NGUYÊN: dev-ba-kit (toolbox) · superpowers (brainstorming/writing-plans)
Bước 4  ~/CLAUDE.md thêm đúng 1 dòng trỏ tới pipeline — không viết lại file
Rollback  move ngược lại
```

Không move gì cho tới khi người dùng duyệt từng mục.

### 10.2 Bootstrap — chỗ design gặp thực tế

Rủi ro lớn nhất: **schema và rubric đang viết dựa trên giả định về output của `dev-ba-kit`, chưa nhìn thấy output thật.**

```
Bước 0 — feature mồi
  Chọn 1 feature THẬT nhưng nhỏ từ workspace, loại đã biết đáp án.
  Chạy tay từng skill (/prd-epic /ac /test-cases), KHÔNG gate, KHÔNG pp.
  Mục đích duy nhất: thu output thật.

Bước 1 — schema bám output thật
  Viết schema/<stage>.json khớp ĐỊNH DẠNG THẬT.
  Format quá tự do để bắt ID → thêm `pp normalize` chèn XML tag sau khi skill chạy.
  Lớp dev-ba-kit vẫn bất khả xâm phạm.

Bước 2 — rubric sinh từ lỗi thật
  Liệt kê ĐÚNG những chỗ người dùng thấy sơ sài trong output mồi.
  Mỗi chỗ → một tiêu chí rubric.

Bước 3 — bật gate, chạy lại CHÍNH feature đó
  So chất lượng trước/sau. Bằng chứng, không phải niềm tin.
```

### 10.3 Thứ tự xây — mỗi bước tự chạy được

| # | Xây gì | Chạy được ngay điều gì |
|---|---|---|
| 1 | `pp` khung: `init/status/advance/gate/approve` + `STATE` + evidence | pipeline đi hết lượt, chưa có T2 |
| 2 | Schema + **T1 cho `10-prd` và `40-testplan`** | hai stage đau nhất đã có cổng |
| 3 | Hooks: `Stop` + `PreToolUse` | gate thành luật |
| 4 | T2 reviewer + rubric cho `10-prd`, `40-testplan` | trị "sơ sài / thiếu edge case" |
| 5 | `30-contract` + handoff orchestrator + drift check | nối vào code |
| 6 | `50-security` (skill mới) | phủ nốt role thiếu |
| 7 | `90-archive` + vòng lặp `lessons` | hệ thống tự cải thiện |
| 8 | v2: score · `pp size` · `pp report` · `pp board` | tiện, không cấp bách |

Dừng được ở bất kỳ bước nào. Sau bước 4 đã giải quyết phần lớn điểm đau §1.3.

### 10.4 Tiêu chí khai tử

- Sau **3 feature thật**, phần phi-dev vẫn >30 phút/feature → cắt stage, hoặc bỏ.
- `override` nhiều hơn `approve` → dừng xây, sửa gate trước.
- Chất lượng PRD/testcase **không khác** so với gọi skill bằng tay → vứt lớp conductor, giữ lại T1 gate + rubric.

Thà đặt sẵn tiêu chí dừng còn hơn nuôi thêm một framework thứ tư nằm chết trong `~/.claude/`.

---

## Phụ lục A — 10 nguồn research và phần chắt lọc

| # | Nguồn | Chắt lọc | Vào v1? |
|---|---|---|---|
| 1 | **BMAD-METHOD** | "một persona = một artifact có version"; khái niệm QA gate. **Tránh:** rất nặng (một so sánh thực nghiệm: OpenSpec 12 phút / Spec Kit 90 phút / BMAD 5,5 giờ cho cùng một CRM dashboard); có Orchestrator agent = mắt xích yếu | ý tưởng |
| 2 | **GitHub Spec Kit** | **`constitution.md`** — nguyên tắc bất di bất dịch mọi spec kế thừa | ✅ |
| 3 | **OpenSpec** | **delta-spec** (viết cái gì đổi so với hiện trạng — hợp brownfield); **stage `archive`** | ✅ |
| 4 | **Agent OS v3** | **index + injection theo ngữ cảnh** → `index.yml` map stage → skill; `discover-standards` | ✅ |
| 5 | **`ralph-wiggum` plugin** (chính thức, `anthropics/claude-code`) | **Stop hook** chặn kết thúc lượt. **Sửa:** `--completion-promise` (LLM tự khai) → **exit code** | ✅ |
| 6 | **HumanLayer ACE-FCA** | **FIC** — artifact là ranh giới nén context, giữ 40–60%; suy ra `inputs:` khai báo tường minh + subagent mới mỗi stage | ✅ |
| 7 | **AWS Kiro** | **EARS notation** cho AC — mỗi AC một `SHALL`, script kiểm được, map 1-1 sang test case; steering + hooks | ✅ |
| 8 | **`anombyte93/prd-taskmaster`** | **Evidence file** ("một `Exit status` khác 0 là chặn"; *"completion a deterministic state, not a claim"*); placeholder = hard fail; **chấm điểm** thay pass/fail; `economy-report` | ✅ (điểm số → v2) |
| 9 | **`claude-task-master`** | **XML tag** trong markdown để parse chắc chắn; **complexity → độ sâu** (`pp size` S/M/L tự chọn bộ stage); tool modes tiết kiệm token | ✅ (size → v2) |
| 10 | **Anthropic — hệ multi-agent research** | Cảnh báo: orchestrator-worker **+90,2%** nhưng **~15x token**; token giải thích **80% phương sai**; **kém hiệu quả với việc phụ thuộc chặt — tức là coding**. Ba pattern lấy được mà không cần swarm: (1) đẩy state ra ngoài, (2) worker tự chứa, (3) verify bằng lượt riêng — **chính là 3 lớp của thiết kế này** | ✅ (nền tảng) |

*(Nhóm Conductor / Crystal / Vibe Kanban — worktree mỗi agent — đã được orchestrator phủ. Chỉ lấy một ý: `pp board` liệt kê mọi feature đang ở stage nào → v2.)*

### So sánh với "Ralph loop"

| | Ralph loop | Pipeline này |
|---|---|---|
| Prompt qua mỗi vòng | không đổi | đổi theo stage |
| Điều kiện dừng | khớp chuỗi văn bản LLM tự nói | **exit code của script** |
| Trạng thái | ngầm trong file + git history | tường minh trong `STATE.md` |
| Phanh | `--max-iterations` | trần 3 lần/stage, ghi trong state |
| Phạm vi | một mục tiêu | 9 stage của cả vòng đời |

**Ralph là vòng lặp không trạng thái; đây là máy trạng thái có cổng.** Chúng lồng nhau: Ralph là vòng *trong* (sửa tới khi gate xanh), pipeline là vòng *ngoài*.

---

## Phụ lục B — Nguồn

- BMAD-METHOD — https://github.com/bmad-code-org/BMAD-METHOD
- GitHub Spec Kit — https://github.com/github/spec-kit · https://github.github.com/spec-kit/
- OpenSpec — https://github.com/Fission-AI/OpenSpec
- Agent OS — https://github.com/buildermethods/agent-os
- ralph-wiggum plugin — https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/README.md
- Ralph Wiggum as a "software engineer" — https://ghuntley.com/ralph/
- HumanLayer ACE-FCA — https://github.com/humanlayer/advanced-context-engineering-for-coding-agents
- AWS Kiro requirements-first — https://kiro.dev/docs/specs/feature-specs/requirements-first/
- EARS notation — https://www.jamasoftware.com/requirements-management-guide/writing-requirements/adopting-the-ears-notation-to-improve-requirements-engineering/
- prd-taskmaster — https://github.com/anombyte93/prd-taskmaster
- claude-task-master — https://github.com/eyaltoledano/claude-task-master
- Anthropic multi-agent research system — https://blog.bytebytego.com/p/how-anthropic-built-a-multi-agent
- So sánh SDD frameworks — https://medium.com/@richardhightower/agentic-coding-gsd-vs-spec-kit-vs-openspec-vs-taskmaster-ai-where-sdd-tools-diverge-0414dcb97e46
