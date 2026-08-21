# pp-bugfix & pp-change — Design Spec

Ngày: 2026-08-20 · Trạng thái: đã duyệt design, chờ implementation plan
Spec nền: [2026-08-18-agent-product-pipeline-design.md](2026-08-18-agent-product-pipeline-design.md) — mọi thuật ngữ (gate T1/T2, stale, human gate, guard, conductor) giữ nguyên nghĩa ở đó.

## 1. Bối cảnh và vấn đề

Pipeline hiện tại chỉ có một loại việc: feature mới (`/pp-new` → template `pipeline.S/M.json`).
Hai loại việc chiếm phần lớn đời thật chưa có đường đi:

- **Bug** — cần reproduce → root cause **trước** khi bàn chuyện sửa. Ép bug đi qua
  PRD/user story là sai nghi thức; bỏ qua pipeline thì mất toàn bộ evidence discipline.
- **Change request** — thay đổi hành vi đã có. Cần impact analysis trên artifact cũ trước khi
  cam kết phạm vi. Spec nền §9.3 chỉ xử lý đổi ý **giữa chừng** (stale + re-gate); thay đổi
  trên feature **đã xong** — hoặc trên code brownfield chưa từng qua pipeline — chưa có chỗ đứng.

Ràng buộc brownfield (từ người dùng): đa số hành vi hiện có của hệ thống **không có artifact**
trong `features/` — pipeline change phải chạy được cả khi không tìm thấy feature gốc.

Research đối chứng (2026-08-20, chi tiết Phụ lục A): spec-kit core không có bugfix/change và đó
là pain point lớn của cộng đồng; spec-kit-extensions, BMAD, Kiro, OpenSpec, em-team đều hội tụ
về cùng bộ pattern: bugfix thay stage đầu bằng reproduce→root-cause, change bắt buộc impact
analysis + delta trên spec cũ, route theo kích thước, test strategy là trục phân biệt loại việc.

## 2. Quyết định đã chốt (Q&A với người dùng)

| # | Câu hỏi | Quyết định |
|---|---|---|
| 1 | Neo vào feature cũ? | Tùy chọn `--from <feature>`; không có thì vẫn chạy (brownfield) |
| 2 | Pipeline kết thúc ở đâu? | Dừng ở artifact như S/M (không gồm 60-dev, 90-archive — vòng sau) |
| 3 | Human gate | Bugfix: sau `05-diagnosis`. Change: sau `10-prd` delta. Mỗi pipeline đúng 1 gate |
| 4 | Ranh giới với §9.3 | Đổi ý giữa chừng vẫn dùng stale sẵn có. pp-change cho feature đã xong / brownfield; không tìm thấy feature gốc → tạo folder mới, impact reverse-doc từ code |
| 5 | Kiến trúc | Template theo loại việc (`--type`), dùng chung toàn bộ bộ máy gate/state/audit |

## 3. Cơ chế `--type`

### 3.1 `pp init <feature> --type feature|bugfix|change [--size S|M] [--from <feature-cũ>]`

- `--type` mặc định `feature` → hành vi hiện tại y nguyên (chọn template theo `--size`).
- `bugfix`/`change` → nạp `templates/pipeline.bugfix.json` / `pipeline.change.json`; `--size` bị bỏ qua.
- Type **lạ → exit 2**, không fallback. (Size lạ fallback về M vì size là gợi ý; type là ngữ
  nghĩa của cả pipeline — đoán sai là chạy sai pipeline.)
- Template mang field `"type"` ở gốc; S/M được thêm `"type": "feature"`. `pp status`/`report`/
  audit nhờ đó phân loại được loại việc. *(Điểm kiểm khi implement: `readConfig` và mọi chỗ đọc
  `size` phải chịu được template không có `size`.)*
- Scaffold `00-brief.md` **theo type** — tên file giữ nguyên (brief vẫn là tiếng nói của người,
  bộ máy không cần biết type qua tên file):
  - bugfix: khung *Hiện tượng / Mong đợi / Unchanged behavior / Cách tái hiện (nếu biết)*
  - change: khung *DELTA trên hành vi đã có / vì sao cần*
  - feature: giữ scaffold DELTA hiện tại.

### 3.2 `--from <feature-cũ>` (chỉ hợp lệ với `--type change`)

- init resolve feature cũ trong `features/` **hoặc** `features/_archive/`:
  - Tìm thấy → ghi `"from": "<slug>"` vào `pipeline.json` và **nối thêm inputs** cho stage
    `05-impact`: `../<cũ>/00-brief.md?`, `../<cũ>/10-prd.md?`, `../<cũ>/40-testplan.md?`
    (hoặc tiền tố `../_archive/` tùy nơi tìm thấy; dấu `?` = optional, cú pháp sẵn có — feature
    cũ thiếu file nào thì bỏ qua file đó). Tiêm lúc init vì `pipeline.json` chỉ `pp` được ghi
    (guard chặn agent) — không có cơ hội sửa sau.
  - Không tồn tại → **exit 2**, in danh sách feature gần đúng để người dùng chọn lại.
- `--from` + `--type` khác `change` → exit 2 (chưa định nghĩa ngữ nghĩa — YAGNI).
- Feature cũ **không bị ghi gì** — artifact đã ship là lịch sử đóng băng (bài học BMAD #1930).
  Liên kết một chiều qua field `from` + inputs.

### 3.3 Hai mở rộng nhỏ của bộ máy (dùng chung mọi type)

1. **Schema override theo stage** — stage trong `pipeline.json` có field tùy chọn
   `"schema": "<tên>"` → `registry.checksFor` nạp `schema/<tên>.json` thay vì
   `schema/<stage-id>.json`; vắng field thì như cũ. (~3 dòng trong `lib/registry.js`.)
   Dùng cho: stage `10-prd` của change giữ nguyên id (thừa hưởng bộ check story/AC trong
   `lib/checks/prd.js`) nhưng đòi thêm heading Delta qua `schema/10-prd.change.json`.
2. **`"reads_workspace": true`** trên stage — chỉ thị `pp advance` in thêm dòng
   *"Được đọc (read-only): code repo trong workspace"*. Diagnosis/impact cần soi code thật;
   guard không đổi (guard chỉ chặn ghi), đây thuần là nới ranh giới đọc trong chỉ thị.
   Reviewer T2 giữ nguyên quyền hiện tại (chỉ đọc artifact + rubric) — kiểm path tồn tại đã là
   việc của T1 `cited-paths`.

**Không đổi:** `advance` (vòng lặp), `gate.js`, `guard.js`, `plan.js`, `state.js`,
`evidence.js`, cơ chế stale/`inputs_hash`/`artifact_hash`, audit, conductor `/pp`.
Thứ tự stage vẫn là sort theo id — `05-* < 10-* < 15-* < 40-*` tự đúng.

## 4. Pipeline bugfix — `templates/pipeline.bugfix.json`

```
05-diagnosis → [HUMAN GATE] → 15-fixplan → 40-regression → hết
```

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

Không có 10-prd — đúng pattern "route theo kích thước" của BMAD: bug không cần PRD,
nghi thức tỷ lệ với rủi ro.

### 4.1 `05-diagnosis` — schema/rubric

Heading bắt buộc (`schema/05-diagnosis.json`):

| Heading | Nội dung | Được kiểm bởi |
|---|---|---|
| Tái hiện | Các bước cụ thể chạy lại được + bằng chứng (log/output) | T1 heading + T2 |
| Root cause | Nguyên nhân gốc, **bắt buộc cite đường dẫn code thật** | T1 `cited-paths` (path phải tồn tại trong workspace) + T2 |
| Giả thuyết đã loại | Các hướng đã điều tra và loại, kèm căn cứ | T2 |
| Unchanged behavior | Cái gì phải giữ nguyên sau fix — `40-regression` truy vết về đây | T2 + traceability ở 40-regression |

Rubric T2 (`rubric/05-diagnosis.md`) chấm: repro có chạy lại được theo đúng bước không ·
root cause là *nguyên nhân* hay mới là *triệu chứng* · giả thuyết loại có bằng chứng hay đoán ·
unchanged behavior có cụ thể/đo được không.

Luật sắt (superpowers/em-team): **không tái hiện được thì không đi tiếp**. Thi hành bằng gate
sẵn có, không thêm cơ chế: agent không tái hiện được thì phải ghi thật vào artifact → T2 trượt
mục Tái hiện → 3 vòng đỏ → `blocked`; lối ra là `pp unblock --reason` (ghi `lessons/`) —
đúng vòng học hiện có.

**Human gate tại đây** (`pp approve <f> 05-diagnosis`): root cause sai thì fixplan lẫn
regression đều vứt — gác người vào đúng chỗ đắt nhất, cùng logic gate sau 10-prd của
pipeline feature.

### 4.2 `15-fixplan`

Gate `[t1]` — doc ngắn, T1 đủ; T2 dồn cho diagnosis và regression. Heading bắt buộc
(`schema/15-fixplan.json`): **Phạm vi sửa** (file/module sẽ đụng — cite path thật, T1 kiểm) ·
**Hướng sửa** (1 root cause = 1 fix, không chồng fix) · **Rollback** (chưa nghĩ được đường lùi
thì chưa được tiến — ITIL/em-team).

### 4.3 `40-regression`

Id **riêng**, không dùng lại `40-testplan`: bộ check testplan hiện tại gắn cứng traceability
theo AC (`lib/checks/testplan.js`) mà bugfix không có AC — ép chung id là ép check sai ngữ nghĩa.

Schema (`schema/40-regression.json`) đòi đủ **3 loại test** (pattern Kiro):

1. Test tái hiện bug — phải **ĐỎ trước fix** (chứng minh bug tồn tại);
2. Test xác nhận fix (xanh sau fix);
3. Test bảo vệ Unchanged behavior — **mỗi mục** Unchanged trong `05-diagnosis.md` có ít nhất
   1 test truy vết về nó.

T1 vòng đầu kiểm bằng heading; check đếm/truy vết dạng JS (như testplanChecks) thêm sau nếu
rubric T2 tỏ ra không đủ — quyết định lúc implement, không phình scope ở đây.
Rubric T2 (`rubric/40-regression.md`) chấm đủ 3 loại + độ phủ Unchanged.

## 5. Pipeline change — `templates/pipeline.change.json`

```
05-impact → 10-prd (delta) → [HUMAN GATE] → 40-testplan → hết
```

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

(`--from` tiêm thêm inputs cho `05-impact` như §3.2.)

### 5.1 `05-impact` — hai chế độ, một artifact

- **Có feature cũ** (`--from`): mục Hiện trạng đọc từ artifact cũ; impact = đối chiếu yêu cầu
  mới với PRD/testplan cũ.
- **Brownfield không artifact** (không `--from`): agent đọc code thật trong workspace → viết
  mục Hiện trạng như một **reverse-doc thu nhỏ** — chỉ phần liên quan, không doc cả hệ
  (pattern BMAD `document-project`, spec-kit discussion #331). Mọi khẳng định hiện trạng phải
  cite path code thật — `cited-paths` kiểm được.

Heading bắt buộc (`schema/05-impact.json`): **Hiện trạng** (ghi rõ nguồn: artifact cũ hay code) ·
**Thành phần bị ảnh hưởng** (file/module/contract, cite path) · **Backward compatibility**
(hành vi giữ nguyên, ai đang phụ thuộc) · **Rủi ro & lối đi** (chỉnh trực tiếp / rollback /
re-scope — chọn một, nói vì sao; pattern BMAD correct-course).

Rubric T2 (`rubric/05-impact.md`) chấm: hiện trạng có bịa không (đối chiếu cite) · danh sách
ảnh hưởng có sót nơi code đang gọi tới không · backward-compat có đo được không.

### 5.2 `10-prd` delta

Giữ id `10-prd` → thừa hưởng nguyên bộ check story/AC và nhịp "ép hỏi trước khi viết"
(`10-questions.md`). Khác duy nhất: `"schema": "10-prd.change"` —
`schema/10-prd.change.json` = toàn bộ schema `10-prd.json` **+ heading Delta**: mỗi thay đổi
đánh dấu `ADDED / MODIFIED / REMOVED` so với hiện trạng đã chốt ở `05-impact.md`
(pattern OpenSpec) — PRD delta, không phải PRD viết lại.

Rủi ro trôi dạt hai file schema: chặn bằng test khẳng định `10-prd.change.json` là superset
heading của `10-prd.json` (§7).

**Human gate tại đây**: ký trên cam kết phạm vi, khi đã có cả impact lẫn đề xuất cụ thể.

### 5.3 `40-testplan`

Dùng lại **nguyên trạng** stage hiện có (schema, rubric, checks traceability-AC) — PRD delta có
AC nên bộ máy cũ khớp luôn, thêm 0 dòng code.

## 6. Slash command

### 6.1 `/pp-bugfix <nguồn...>` — `commands/pp-bugfix.md` (+ bản sao `.claude/commands/`)

Mô phỏng đúng nhịp `/pp-new`, khác ở bước 3 và khung brief:

1. Nhận diện nguồn — dùng lại y nguyên luật nạp nguồn của pp-new (MCP Atlassian cho Jira/
   Confluence, WebFetch, excel-to-md, nguyên văn vào `refs/`). **Log lỗi / stack trace dán
   thẳng cũng là nguồn hợp lệ** — chép nguyên văn.
2. Chốt tên (gợi ý tiền tố `fix-…`), khớp `^[a-z0-9][a-z0-9-]*$`, hỏi người dùng xác nhận.
3. `pp init <f> --type bugfix`.
4. Nạp refs (một nguồn một file, dòng đầu ghi nguồn gốc + thời điểm).
5. Nháp `00-brief.md` theo khung *Hiện tượng / Mong đợi / Unchanged / Cách tái hiện* —
   chỉ từ refs; thiếu thông tin thì ghi câu hỏi vào cuối brief, không tự trả lời hộ.
6. **DỪNG** — in brief, chờ người duyệt; họ tự chạy `/pp <f>`.

Conductor `/pp` không đổi một chữ — nó vốn stage-agnostic, chỉ đọc output `pp advance`.

### 6.2 `/pp-change <nguồn...>` — như trên, thêm bước tìm feature gốc trước init

- Quét `features/` + `features/_archive/` (tên thư mục + grep nội dung brief/PRD theo từ khóa
  nguồn). Tìm thấy ứng viên → **hỏi người dùng xác nhận** → `pp init <f> --type change --from <cũ>`.
- Không thấy → nói rõ *"không có artifact cũ — stage impact sẽ reverse-doc hiện trạng từ code"*
  → init không `--from`. **Không bao giờ tự đoán im lặng.**
- Brief khung DELTA trên hành vi đã có.

## 7. File đụng tới và test

| Loại | File |
|---|---|
| Mới | `templates/pipeline.bugfix.json`, `templates/pipeline.change.json` · `schema/05-diagnosis.json`, `schema/15-fixplan.json`, `schema/40-regression.json`, `schema/05-impact.json`, `schema/10-prd.change.json` · `rubric/05-diagnosis.md`, `rubric/40-regression.md`, `rubric/05-impact.md` · `commands/pp-bugfix.md`, `commands/pp-change.md` (+ `.claude/commands/`) |
| Sửa | `lib/commands/init.js` (`--type`, `--from`, scaffold brief theo type, ghi `type`/`from`) · `lib/registry.js` (schema override) · `lib/commands/advance.js` (dòng reads_workspace trong chỉ thị) · `lib/commands/doctor.js` (kiểm 2 template mới) · `templates/pipeline.S.json`, `templates/pipeline.M.json` (thêm `"type": "feature"`) · `README.md`, spec nền §4 (bảng stage map thêm ghi chú type) |
| Không đụng | `gate.js`, `guard.js`, `plan.js`, `state.js`, `evidence.js`, `commands/pp.md` |

Test (theo nếp `tests/` hiện có):

- `init --type`: đủ nhánh — type lạ exit 2, bugfix/change nạp đúng template, brief scaffold
  đúng khung, `type` ghi vào pipeline.json; S/M không đổi hành vi (regression).
- `init --from`: resolve ở `features/` và `_archive/`, tiêm inputs đúng tiền tố; không tồn tại
  exit 2 + gợi ý; `--from` với type khác change exit 2.
- Shape 2 template mới khớp chuẩn `tests/artifact-shape.test.js`.
- `stage-order`: `05-* → 10-*/15-* → 40-*` đúng thứ tự; human gate dừng đúng chỗ.
- Registry: stage có `"schema"` override nạp đúng file; vắng field giữ hành vi cũ.
- Schema superset: heading của `10-prd.change.json` ⊇ `10-prd.json` (chống trôi dạt).
- E2E rút gọn: init bugfix → gate `05-diagnosis` đỏ khi thiếu heading Tái hiện, xanh khi đủ →
  approve → advance trỏ `15-fixplan`.
- `docs-cites` cho 2 command mới.

## 8. Error handling

| Tình huống | Hành vi |
|---|---|
| Type lạ | init exit 2, không fallback |
| `--from` không tồn tại | init exit 2 + liệt kê ứng viên gần đúng |
| `--from` + type ≠ change | init exit 2 |
| Bug không tái hiện được | T2 trượt là hành vi đúng → 3 vòng → blocked → `pp unblock --reason` (ghi lessons/) |
| Template hỏng/thiếu | `pp doctor` báo; init đọc template lỗi JSON → exit 2 với thông báo rõ |
| Feature cũ thiếu artifact (`--from` một phần) | inputs có `?` — thiếu file nào bỏ file đó, impact ghi rõ nguồn nào có |

## 9. Non-goal (cố ý không làm vòng này)

- **60-dev handoff, 90-archive** — bài toán chung mọi pipeline, làm một lần cho cả ba type sau.
- **Pipeline hotfix** (test-sau-fix + post-mortem 48h) và **refactor** (metrics trước/sau) —
  pattern đã ghi nhận từ spec-kit-extensions, thêm khi có nhu cầu thật.
- **Sync ngược delta vào artifact feature cũ** (kiểu OpenSpec archive) — pp không có "specs/
  nguồn sự thật trung tâm"; mỗi feature là hồ sơ có STATE/evidence/audit riêng, đã đóng là lịch
  sử. Truy vết đi qua field `from` + mục Hiện trạng của `05-impact.md`. Nếu sau này cần bức
  tranh hiện hành tổng hợp, đó là một lệnh đọc riêng — ngoài scope.
- **`--from` cho bugfix** — thêm khi định nghĩa được ngữ nghĩa rõ.

## Phụ lục A — Research đối chứng (2026-08-20)

| Nguồn | Điều rút ra cho design này |
|---|---|
| [github/spec-kit](https://github.com/github/spec-kit) (issues [#1191](https://github.com/github/spec-kit/issues/1191), [#1436](https://github.com/github/spec-kit/issues/1436), [discussion #331](https://github.com/github/spec-kit/discussions/331)) | Core không có bugfix/change → pain point cộng đồng; brownfield chữa bằng research-doc từ codebase |
| [MartyBonacci/spec-kit-extensions](https://github.com/MartyBonacci/spec-kit-extensions) | `/speckit.bugfix`: bug-report → root cause → fix, regression test viết trước fix; `/speckit.modify`: bắt buộc impact-analysis + tham chiếu feature gốc; bảng test-strategy theo loại việc |
| [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) (V4 brownfield, `correct-course`, [#1930](https://github.com/bmad-code-org/BMAD-METHOD/issues/1930)) | Route theo kích thước (bug nhỏ không cần PRD); Sprint Change Proposal = impact checklist + draft edit từng artifact; artifact đã đóng không được sửa ngược |
| [Kiro](https://kiro.dev/blog/specs-bugfix-and-design-first/) | Bugfix spec: Current / Expected / **Unchanged** Behavior; 3 loại test (chứng minh bug, chứng minh fix, bảo vệ Unchanged) |
| [obra/superpowers](https://github.com/obra/superpowers) `systematic-debugging` | Iron Law: không fix khi chưa reproduce + confirm root cause; giả thuyết loại phải ghi lại; 3 lần fail → escalate người |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec) | Change = delta ADDED/MODIFIED/REMOVED trên spec cũ, không viết lại |
| em-team `bug-fix.md` (local) | Pipeline gate-based: INVESTIGATE (gate reproducible) → ANALYZE → FIX (test đỏ trước fix); bug không reproduce → NEEDS_CONTEXT, không đi tiếp |
| [Agent OS](https://github.com/buildermethods/agent-os) | Đối chứng ngược: không làm pipeline riêng → bug/change rơi vào ad-hoc — đúng gap mà design này lấp |
| ITIL change enablement / defect workflow chuẩn | RFC → impact & risk → approval → implement → verify; defect: reproduce bắt buộc trước fix, regression test đỏ trước |
