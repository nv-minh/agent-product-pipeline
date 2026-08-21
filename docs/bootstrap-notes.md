# Bootstrap — lần chạy thật đầu tiên

Ngày: 2026-08-20 · Feature mồi: `archive-command` (dogfood — chính lệnh `pp archive`
mà README/CHANGELOG/spec đã nhắc nhưng chưa tồn tại).

Đây là bước §10.2 của design spec ("bootstrap — nơi thiết kế gặp thực tế") và Task
8/15 của plan, trước đó chưa từng chạy: `features/` rỗng, 81 checkbox chưa tick.

## Kết quả: pipeline đi hết được

`00-brief` → `10-prd` (T1 ✓, T2 ✓, approve ✓) → `40-testplan` (T1, T2) → `complete`.
`pp report` và `pp usage-sync` đều ra số thật (28 mục token khai thác từ transcript
của chính phiên này, gán đúng về 10-prd/40-testplan).

Điều đáng nói nhất: **cả hai tầng gate đều thực sự bắt lỗi, không phải trang trí.**
T1 chặn một testplan sai schema; T2 chặn một testplan sai bản chất (xem F2 dưới).
Không có lần nào phải dùng `pp override`.

## Lỗi lộ ra trong lúc chạy (đã sửa ngay)

### F1 — Mọi lệnh `pp` gợi ý đều thiếu tên feature → gõ theo là lỗi
`pp advance` in `gate xanh, chờ duyệt: pp approve 10-prd`. Gõ đúng như vậy thì
`parseArgs` lấy `"10-prd"` làm feature, stage thành `undefined`, lệnh thoát 2 kèm
dòng usage. Hai gợi ý `pp unblock` còn thiếu cả `--reason` vốn bắt buộc.

Ba chỗ ở `lib/plan.js` (blocked ×2, await-human ×1). Đây là lớp lỗi **chỉ hiện ra
khi có người thật đọc rồi làm theo** — và nó đánh đúng vào khoảnh khắc người dùng
đang bế tắc. Không test nào cũ bắt được vì tất cả đều so chuỗi, không ai chạy thử
chuỗi đó.

Đã sửa (nội suy `config.feature`) + `tests/suggested-commands.test.js`: test TRÍCH
lệnh ra khỏi output rồi CHẠY nó, đòi không thoát 2. Cách test này bắt được cả các
gợi ý mới thêm về sau.

### F2 — T1 đánh đỏ chính thứ spec §5.1 bắt buộc (finding B1, đã kéo lên làm ngay)
Viết `40-testplan.md` đúng như spec dặn ("mỗi field số/chuỗi/ngày có ≥1 `boundary`;
mỗi endpoint có phân quyền có ≥1 `permission`") thì nhận:

```
$ pp-check tc-schema 40-testplan.md
  TC-017: type "boundary" không hợp lệ — phải là "positive" hoặc "negative"
  TC-018: type "permission" không hợp lệ — phải là "positive" hoặc "negative"
Exit status: 1
```

Nguyên nhân: một hằng số `KNOWN_TYPES` bị dùng cho **hai việc khác nhau** — (a)
`type` được phép nhận giá trị nào, (b) mỗi AC bắt buộc có loại nào. Đã tách thành
`VALID_TC_TYPES` (bốn loại, theo spec) và `REQUIRED_AC_TYPES` (chỉ positive +
negative). Cùng một file `40-testplan.md`, không sửa một chữ, chuyển từ đỏ sang xanh.

`boundary`/`permission` **chưa** bị ép định lượng: ép "mỗi field số/chuỗi/ngày" đòi
suy kiểu dữ liệu từng field từ PRD, dễ đỏ oan hơn là bắt lỗi thật — để rubric T2
chấm (tiêu chí 4 "phép thử đột biến" đã hỏi đúng câu đó).

### F3 — `updated` trong STATE.md đóng băng ở lần ghi đầu tiên
`pp report` in `thời gian: … 08:12:06 → …` trong khi lần ghi thật cuối là 08:23:14.
`writeState` cũ viết `state.updated ?? new Date()`; `readState` trả nguyên `updated`
cũ, nên mọi lần ghi sau đều giữ lại giá trị của `pp init` — **sai 11 phút ở đúng cái
trường mà công việc duy nhất của nó là nói "file này được ghi lúc nào"**. Hai chỗ
(JSON và dòng người đọc) còn gọi `new Date()` riêng nên có thể lệch nhau.

Đã sửa: tính một lần tại thời điểm ghi, luôn làm mới. + `tests/state-updated.test.js`.

## Quan sát về THIẾT KẾ gate (chưa sửa — cần bạn quyết)

### O1 — Luật "mỗi AC phải có ≥1 negative" tạo áp lực dán nhãn sai
Bốn trong bảy AC của feature này (`AC-1-2`, `AC-1-3`, `AC-2-2`, `AC-2-3`) có **hành
vi chính là từ chối**. Với chúng, "case thuận" đã là một lần từ chối rồi. Cách dễ
nhất để thoả bộ đếm `type-ratio` của T1 là viết một case mong đợi **thành công** rồi
dán nhãn `negative` — và đó đúng là điều đã xảy ra ở vòng 1: TC-005/007/012/014 đều
`type="negative"` nhưng `expected: exit 0`.

T1 xanh trơn. **T2 mới bắt được**, high severity, và chặn đúng:

> Chúng là positive case bị dán nhãn negative để thoả bộ đếm type-ratio của T1.

Đây là bằng chứng tốt cho kiến trúc hai tầng (T1 đếm được, T2 đọc được ý nghĩa).
Nhưng nó cũng cho thấy `type-ratio` áp cứng cho **mọi** AC là hơi thô. Lựa chọn:
(a) giữ nguyên và dựa vào T2 — như lần này, hoạt động được;
(b) chỉ đòi negative khi AC không phải dạng `IF … SHALL từ chối/trả lỗi`;
(c) đổi thông điệp T1 để nhắc thẳng "đừng dán nhãn để thoả bộ đếm".
Khuyến nghị: (a) + (c) — đừng làm T1 thông minh hơn, làm nó nói rõ hơn.

### O2 — T2 tự chấm chính mình (finding A3, chưa sửa)
Lần chạy này tôi vừa viết artifact vừa viết verdict T2, vì
`review-record --verdict <file>` nhận đường dẫn bất kỳ và không có gì ràng buộc
verdict với output của subagent `pp-reviewer`. Tôi đã cố chấm đối kháng thật (và T2
đã đỏ một vòng), nhưng **tính chất "reviewer không thấy quá trình viết" đã mất** —
đúng lỗ hổng A3. Nonce một lần (Phase 1) là thứ chặn được đường này.

## Ghi nhận nhỏ

- Header của mỗi file evidence (`lib/evidence.js:21`) in một dòng lệnh **không chạy
  lại được**: `pp gate 10-prd --tier t1` — thiếu tên feature, và dùng `--tier`, một
  flag mà `lib/commands/gate.js` bỏ qua im lặng (finding B4). Tier in ra là tier
  thật (`t1`/`t2`, không phải hardcode), nhưng dòng đó tự nhận là câu lệnh tái lập
  lần chạy này thì lại không tái lập được — cùng họ với F1, chỉ khác là nằm trong
  bằng chứng thay vì trong hướng dẫn.
- `pp report` in `attempts 0` cho `40-testplan` dù thực tế có **2 lần đỏ**
  (`tiers.t1.attempts=1`, `tiers.t2.attempts=1`). Số §9.4 cần để tự giám sát không
  hiển thị ở đâu cả (finding D3).
- `current:` trong STATE.md luôn là `(hoàn tất)` ngay từ lúc init (finding D4).
- `rubric/10-prd.md:30` cite `tests/fixtures/real/NOTES.md` — không tồn tại. Chính
  `checkCitedPaths` sẽ bắt lỗi này nếu nó soi cả `rubric/` (finding D7).
- Không có `--workspace` thì **mọi** cite path trong PRD đỏ oan (đã sửa ở C5, và đây
  là lý do nó là blocker của bootstrap chứ không phải việc dọn dẹp).

## Thứ tự đề nghị cho Phase 1–4 sau bootstrap

Bootstrap không đảo lộn thứ tự đã chốt. Điều chỉnh:

1. **B1 đã xong** (kéo lên vì nó chặn thật).
2. **A3 (nonce T2) lên đầu Phase 1** — lần chạy này cho thấy T2 là tầng bắt lỗi
   thật sự có giá trị, nên việc nó tự khai được là lỗ hổng đắt nhất còn lại.
3. **A4, A2, A1 giữ nguyên** trong Phase 1.
4. **D3 + D4 nên làm cùng F3** (cùng vùng `state.js`/`report.js`, cùng chủ đề "số
   liệu quan sát được phải nói thật").
5. Phần còn lại giữ nguyên.

---

## Nghiệm thu lại sau Phase 2 (cùng feature `archive-command`)

Phase 2 sửa B2–B6. Chạy lại chính feature bootstrap dưới luật mới, không dựng
feature mới, để xem các luật vừa thêm có bắt được gì trên artifact THẬT.

**Chúng bắt được, và không phải chuyện hình thức:**

- `pp gate archive-command 40-testplan` **đỏ** ngay: thiếu `## Edge cases` + 11 mục
  `edgeCaseChecklist` chưa mục nào có kết luận. Đây đúng là 11 mục đã nằm trong
  `schema/40-testplan.json` từ đầu mà **không dòng code nào đọc** (B3) — tức test
  plan "đã done" ở vòng bootstrap chưa từng bị hỏi về biên nào cả.
- Viết section đó ra rồi thì lộ tiếp một lỗ THẬT: mục `gọi đồng thời` không có test
  case nào, và bản nháp đầu của tôi ghi thẳng "chưa có, sẽ thêm cùng lúc với
  lockfile (C1)". **T2 đánh trượt** tiêu chí 1 — rubric nêu tên "đồng thời" là một
  biên phải phủ. Phán quyết đúng: `pp` chưa có lockfile không phải lý do để không
  VIẾT RA kỳ vọng; kỳ vọng viết trước chính là thứ lockfile của C1 phải thoả. Thêm
  `TC-023` (spawn hai `pp archive` song song, lặp 20 lần, không lần nào cả hai
  exit 0) rồi review lại mới xanh.
- Chuỗi đó cũng là lần đầu **R1 + A3 chạy đúng vai trên dữ liệu thật**: mỗi lần sửa
  artifact, `artifact_hash` làm T2 hết hiệu lực, và nonce cũ bị tiêu thụ nên phải
  phát phiếu mới. Không có đường nào tái dùng phán quyết cũ cho bản mới.

**`pp gate archive-command 10-prd` xanh ngay dưới luật frontmatter mới** (B2) —
artifact bootstrap vốn đã có đủ bốn khoá. Nhưng một lần chạy gate lại **thu hồi
approval** (đúng thiết kế), nên phải `pp approve` lần nữa.

### Lỗi mới tìm được TRONG lúc làm Phase 2

- **Cơ chế checklist "mỗi mục phải có kết luận" chỉ bắt được mục bỏ trống ở DÒNG
  CUỐI section.** Bản cũ so regex `<mục>\s*:\s*(.*)` trên cả khối văn bản; `\s*`
  sau dấu hai chấm ăn luôn ký tự xuống dòng, nên một mục bỏ trống ở giữa section
  **mượn kết luận của mục ngay sau nó** và qua gate. Lỗi này có sẵn trong
  `checkRiskChecklist` của PRD từ đầu và không ai thấy, vì test duy nhất cho nhánh
  "bỏ trống" bỏ trống đúng mục cuối. Chỉ lộ ra khi cơ chế được dùng lần thứ hai.
  Đã sửa (quét từng dòng) + thêm test cho đúng vị trí giữa section.
- **`override` KHÔNG thay được chữ ký người, và tôi đã tưởng ngược lại.** Viết test
  cho B5 với kỳ vọng "override thượng nguồn là thông đường" → đỏ. Code đúng: một
  stage `overridden` mà chưa `approved` thì `nextStage` trả `await-human`, và luật
  thứ tự mới cũng đòi vậy. Hai cửa khác nhau (nội dung / chữ ký), không cửa nào mở
  hộ cửa nào.

### Còn nguyên, chưa sửa

- `pp report` vẫn in `attempts 0` cho mọi stage đã xong, dù `40-testplan` vòng này
  có thêm 2 lần đỏ nữa (finding D3 — Phase 4).
- `current:` trong STATE.md vẫn luôn `(hoàn tất)` (D4 — Phase 4).
- **T2 vòng này do agent điều phối tự chấm, không phải subagent `pp-reviewer` độc
  lập** — phiên làm việc bị cấm spawn subagent. Nonce chứng minh phán quyết thuộc
  về một prompt `pp` đã thật sự phát ra; nó không chứng minh ai viết. Giới hạn này
  đã ghi trong `lib/commands/review.js` và khoá thành test ở
  `tests/review-nonce.test.js`, nhưng vòng nghiệm thu này là một ví dụ sống của nó.

## Nghiệm thu sau Phase 3 + 4 (2026-08-20)

### Sự cố giữa phiên — và vì sao khôi phục được

Một lệnh Bash ghép (probe cho C1) chứa nhầm `git checkout -q -- .` chạy ở cwd
repo: 26 file tracked đang sửa dở của cả ba phase bị revert về HEAD trong một
giây. Khôi phục 100% bằng cách replay toàn bộ Edit/Write từ transcript phiên
làm việc (`~/.claude/projects/<munged>/<session>.jsonl`) lên một bản `git
archive HEAD`, đối chiếu từng file rồi chép về — 414/414 test xanh xác nhận
đúng nguyên trạng. Bài học vận hành: lệnh phá huỷ không bao giờ được nằm trong
lệnh ghép; và một repo nhiều việc chưa commit cần backup tar trước phiên dài.

### Luật mới bắt được gì trên chính repo này

- **C1/C6**: cắt `STATE.md` giữa khối JSON từng chết bằng
  `pp: Expected double-quoted property name in JSON at position 23` — không tên
  file, không lối ra. Nay: tên file + nguyên nhân + hai đường khôi phục thật.
  `writeState` thành temp+rename (không tồn tại thời điểm file dở dang mang tên
  STATE.md); read-modify-write có khoá `.pp-lock` (mkdirSync atomic, tự dọn khoá
  stale >30s, timeout nói rõ lối ra).
- **C2**: `pp init '../../evil' --root /a/b` từng scaffold ra `/a/evil` —
  NGOÀI repo, exit 0, và đường dẫn traverse thoát luôn mọi guard đang canh
  `features/`. Nay allowlist `^[a-z0-9][a-z0-9-]*$` chặn tập trung ở `bin/pp`
  cho MỌI lệnh nhận feature.
- **C3/C4**: `--root` trỏ thư mục rỗng từng scaffold nguyên cây vào đó.
  `constitution.md` là quy ước chung với GitHub Spec Kit nên một mình nó không
  đủ nhận diện product-repo — `pp init` nay đòi marker riêng `.pp-root`;
  các lệnh khác giữ fallback để clone cũ không gãy.
- **D3 — con số biết nói dối được sửa trên dữ liệu thật**: `pp report
  archive-command` nay in `40-testplan | done | vòng-đỏ 3` (đúng lịch sử Phase 2)
  thay vì `attempts 0`, kèm cảnh báo §9.4. Cảnh báo còn lộ thêm một sự thật:
  3 vòng đỏ đó KHÔNG có một dòng bài học nào trong lessons/ (tự sửa, không qua
  unblock) — message nói thẳng điều đó thay vì trỏ vào file không tồn tại.
- **D4**: STATE.md nay ghi `current:` thật ở mọi bước (init → 10-prd,
  approve → 40-testplan, xong hết → "(hoàn tất)"). Staleness vẫn cố ý là thứ
  SUY RA khi đọc, không lưu (triết lý R4) — §9.1 "status: stale" không tồn tại
  trên đĩa.
- **D5**: usage-sync quét được nhiều repo (`--repos`), cwd so prefix, mention
  có ranh giới segment (feature `auth` hết hút dòng của `auth-v2`), và output
  in thẳng giới hạn heuristic.
- **D6**: vòng học đóng — `pp advance` inject 10 dòng cuối `lessons/<stage>.md`
  vào chỉ thị; README hết hứa suông.
- **D7**: repo chịu chính luật của nó — `tests/docs-cites.test.js` chạy
  `checkCitedPaths` trên rubric/README/CHANGELOG/constitution; cite chết
  `tests/fixtures/real/NOTES.md` trong rubric bị xoá; `pp archive` được đánh dấu
  "chưa implement" ở mọi chỗ từng nói như đã có.
- **D2/D8**: biome (devDependency duy nhất — CI guard đổi thành zero RUNTIME
  dep) bắt được 6 warning thật (import/biến/tham số chết, regex khó đọc);
  lane `test:fast` 119 test / ~0.9s; CI thêm lane lint + `node --check`
  (đúng hạng lỗi backtick từng làm 241 test đỏ) + `bash -n` hooks.

### Quyết định cần chủ repo xác nhận

- `package.json` thêm `license: MIT` — chọn mặc định phổ biến vì repo đang
  chuẩn bị public; nếu không đúng ý thì đổi một dòng.

### Số cuối

414/414 test xanh · coverage 99.38% line / 92.26% branch (sàn 99.3/91.5) ·
lint 0 lỗi 0 cảnh báo · `pp doctor` exit 0 · chưa commit gì.

## Intake đa nguồn (2026-08-20, sau Phase 3+4)

Thêm đường vào pipeline từ nguồn bất kỳ, giữ nguyên tắc "brief là tiếng nói
của người":

- `/pp-new <nguồn>` (commands/pp-new.md): init + nạp nguyên văn nguồn vào
  `features/<f>/refs/` + nháp 00-brief.md, rồi DỪNG chờ người duyệt brief.
  Jira/Confluence qua Atlassian MCP; URL qua WebFetch; Excel bắt buộc qua skill.
- Skill `excel-to-md` (skills/excel-to-md/): script Node thuần zero-dep tự đọc
  ZIP (EOCD/central/local + inflateRawSync) và SpreadsheetML → bảng Markdown;
  CSV cùng lệnh; cắt 300 hàng/40 cột CÓ ghi chú; .xls cũ từ chối kèm hướng dẫn.
  Giới hạn nói thẳng trong SKILL.md: formula lấy giá trị cached, merged cell ra
  ô trống, ngày chỉ nhận numFmt built-in (custom ra serial).
- Templates: 10-prd nhận input optional `refs/source.md?` — advance tự liệt kê
  ở dòng Đọc, inputs_hash phủ nguồn. Nghiệm thu e2e: đổi ticket nguồn SAU khi
  PRD done → `pp status` báo regate ngay.
- Luật tự-soi cited-paths bắt được chính commands/pp-new.md cite path mẫu
  chưa tồn tại ngay trong lần chạy đầu — sửa doc theo quy ước placeholder
  `features/<feature>/…`. Luật mới nhất của repo đã kịp trả công.
- Giới hạn: phần intake là hành vi agent (tài liệu); bước MCP/WebFetch không
  unit-test được — chỉ script excel (13 test) và luật pipeline có test máy.
