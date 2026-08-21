// D7 — REPO PHẢI CHỊU CHÍNH LUẬT CỦA NÓ. Gate T1 bắt mọi artifact không được
// cite đường dẫn không tồn tại (`checkCitedPaths`, trụ cột chống ảo giác),
// nhưng luật đó chưa từng soi rubric/ hay README — và đúng ở đó từng có một
// cite chết (rubric/10-prd.md trỏ tests/fixtures/real/NOTES.md, file chưa bao
// giờ tồn tại) sống qua nhiều vòng review. Runtime gate không chạy trên tài
// liệu của repo, nên luật được thi hành ở đây — trong bộ test mà CI bắt buộc.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from './helpers.js'
import { checkCitedPaths } from '../lib/checks/common.js'

const DOCS = [
  'README.md',
  'CHANGELOG.md',
  'commands/pp.md',
  'commands/pp-new.md',
  'commands/pp-bugfix.md',
  'commands/pp-change.md',
  'skills/excel-to-md/SKILL.md',
  'constitution.md',
  ...readdirSync(join(REPO, 'rubric')).filter((f) => f.endsWith('.md')).map((f) => `rubric/${f}`),
]

for (const doc of DOCS) {
  test(`cited-paths: ${doc} không cite đường dẫn chết`, () => {
    const r = checkCitedPaths(readFileSync(join(REPO, doc), 'utf8'), REPO, doc)
    assert.equal(r.ok, true, r.messages.join('\n'))
  })
}

// FINDING (adversarial review 8c825c9..44c1ecb): bảng DOCS trên cho ẢO GIÁC được
// bảo vệ. `LOOKS_LIKE_PATH` đòi có `/` VÀ đuôi mở rộng, và character class không
// nhận `<`/`>` — nên trong commands/*.md, `features/<feature>/00-brief.md` bị
// loại (có `<`), `refs/` bị loại (không đuôi), `00-brief.md`/`STATE.md` bị loại
// (không có `/`). Đếm thật: 4 file commands/ có 29-49 token backtick mỗi file và
// **0** token được kiểm. Thêm hai doc mới vào DOCS vì thế không kiểm gì cả.
//
// Luật thi hành ở đây: mỗi doc trong DOCS phải cite ÍT NHẤT MỘT path thật kiểm
// được. Không đòi số lượng lớn — chỉ đòi bảng này không rỗng nghĩa.
const PHẢI_CÓ_CITE_KIỂM_ĐƯỢC = [
  'commands/pp-new.md',
  'commands/pp-bugfix.md',
  'commands/pp-change.md',
]

// Chuẩn hoá mẫu `<feature>` thành một feature THẬT trong repo, để các path dạng
// `features/<feature>/00-brief.md` trở thành cite kiểm được thay vì bị bỏ qua.
const FEATURE_THẬT = readdirSync(join(REPO, 'features'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
  .map((e) => e.name)[0]

function citesKiểmĐược(text) {
  const cụThể = FEATURE_THẬT ? text.replaceAll('<feature>', FEATURE_THẬT) : text
  return [...cụThể.matchAll(/`([^`\n]+)`/g)]
    .map((m) => m[1].trim())
    .filter((c) => /^[\w./@-]+\/[\w./@-]+\.[a-z]{1,5}$/i.test(c) && !c.includes('://') && !c.startsWith('@'))
}

for (const doc of PHẢI_CÓ_CITE_KIỂM_ĐƯỢC) {
  test(`cited-paths: ${doc} có cite kiểm được (bảng DOCS không rỗng nghĩa)`, () => {
    const cites = citesKiểmĐược(readFileSync(join(REPO, doc), 'utf8'))
    assert.ok(cites.length > 0,
      `${doc} không có một token backtick nào khớp LOOKS_LIKE_PATH — check cited-paths đang chạy trên 0 path`)
  })

  test(`cited-paths: ${doc} — mọi cite CÔNG CỤ sau khi thay <feature> đều tồn tại`, () => {
    // Path dưới `features/<feature>/` là ĐÍCH SẼ GHI (lệnh này tạo ra chúng),
    // không phải file có sẵn — với chúng chỉ đòi thư mục feature tồn tại. Còn
    // path trỏ vào công cụ (lib/, templates/, schema/, rubric/, skills/, docs/)
    // là cite thật: sai tên ở đó là đúng loại cite chết mà D7 nói tới.
    const chết = citesKiểmĐược(readFileSync(join(REPO, doc), 'utf8'))
      .filter((c) => !c.startsWith('features/'))
      .filter((c) => !existsSync(join(REPO, c)))
    assert.deepEqual(chết, [], `cite không tồn tại: ${chết.join(', ')}`)
  })
}
