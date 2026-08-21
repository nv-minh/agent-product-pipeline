// Nối stage id với bộ check tương ứng, cộng thêm schema/<stageId>.json nếu có.
// checksFor đọc schema một cách phòng thủ (existsSync trước) để một stage
// chưa có schema (hoặc stage lạ không map được prd/testplan) vẫn nhận được
// bộ check dùng chung thay vì throw.
import { readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import {
  checkPlaceholders,
  checkHeadings,
  checkCitedPaths,
  checkFrontmatter,
  DEFAULT_FRONTMATTER,
} from './checks/common.js'
import { prdChecks } from './checks/prd.js'
import { testplanChecks } from './checks/testplan.js'
import { regressionChecks } from './checks/regression.js'

// Export để `pp advance` in được ĐÚNG những gì T1 sẽ đòi (heading bắt buộc).
// Một luật được thi hành mà chỉ thị không hề nhắc tới là một cái bẫy: nó sinh ra
// vòng gate đỏ vô ích và áp lực override, đúng thứ §10.4 lấy làm tiêu chí khai tử.
export function loadSchema(root, stageId) {
  const p = join(root, 'schema', `${stageId}.json`)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
}

// FINDING (review 8c825c9..44c1ecb): `{}` phòng thủ ở trên là ĐÚNG khi tên
// schema suy ra từ stage id, và SAI khi stage khai tường minh `"schema": "x"` —
// một typo làm gate chạy với 0 heading + 0 mục rủi ro rồi in XANH. Hai ca đó
// phải tách nhau: tên ngầm định vắng file = "stage không có luật thêm"; tên
// TƯỜNG MINH vắng file = "bản cài không toàn vẹn", và Điều 2 không cho phép
// một gate xanh trên nền không có luật.
export function schemaPath(root, name) {
  return join(root, 'schema', `${name}.json`)
}

// `workspace` = gốc để giải nghĩa đường dẫn được CITE trong artifact (trụ cột
// 3, §6). Trước đây nó bị hardcode `join(root, '..')` — đúng với layout A
// (product-repo nằm cạnh backend-repo/web-repo) nhưng sai ở mọi layout khác:
// clone repo này vào ~/Desktop thì mọi cite được kiểm ngược vào ~/Desktop, nên
// gate chống ảo giác hoặc vô nghĩa (mọi cite đều "không tồn tại" → đỏ oan) hoặc
// vô hại một cách tình cờ. Tham số hoá, giữ nguyên mặc định cũ để không đổi
// hành vi của layout A.
//
// `schemaName` (pp-bugfix/pp-change): stage có thể khai "schema" trong
// pipeline.json để nạp schema/<tên>.json thay vì schema/<stage-id>.json —
// dùng cho 10-prd của pipeline change (giữ id → giữ bộ check PRD, nhưng đòi
// thêm heading Delta). Mặc định = stageId, hành vi cũ không đổi.
export function checksFor(stageId, featureDir, root, workspace, schemaName = stageId) {
  // Override tường minh trỏ vào chỗ không có gì: trả về MỘT check luôn đỏ thay
  // vì im lặng chạy tiếp với schema rỗng. Đặt một mình (không kèm check khác)
  // để evidence nói đúng một điều: luật của stage này đang không nạp được.
  if (schemaName !== stageId && !existsSync(schemaPath(root, schemaName))) {
    return [{
      name: 'schema-ref',
      run: () => ({
        ok: false,
        messages: [
          `pipeline.json khai "schema": "${schemaName}" cho stage ${stageId}, ` +
          `nhưng schema/${schemaName}.json KHÔNG tồn tại`,
          'Gate không chạy trên schema rỗng: heading bắt buộc và checklist rủi ro sẽ biến mất im lặng.',
          'Sửa tên trong pipeline.json, hoặc thêm file schema đó (pp doctor kiểm được).',
        ],
      }),
    }]
  }
  const schema = loadSchema(root, schemaName)
  const citeRoot = workspace ?? join(root, '..')
  // B2 — thứ tự theo đúng §5.1 ("frontmatter hợp lệ · đủ heading bắt buộc ·
  // không còn placeholder · mọi đường dẫn được cite phải tồn tại"): danh tính
  // của file trước, nội dung của file sau.
  //
  // Hai giá trị đối chiếu lấy từ chỗ `pp` biết chắc, không từ artifact:
  // `stageId` là stage đang gate, và tên feature là chính tên thư mục —
  // `featureDir` luôn được dựng bằng `join(root, 'features', feature)`. Dùng tên
  // thư mục thay vì `config.feature` là có chủ ý: thư mục là nơi file THẬT SỰ
  // nằm, còn `pipeline.json` là một trường có thể lệch.
  const common = [
    {
      name: 'frontmatter',
      run: (t) => checkFrontmatter(
        t,
        schema.frontmatter ?? DEFAULT_FRONTMATTER,
        { feature: basename(featureDir), stage: stageId },
        `${stageId}.md`,
      ),
    },
    { name: 'placeholders', run: (t) => checkPlaceholders(t, `${stageId}.md`) },
    { name: 'headings', run: (t) => checkHeadings(t, schema.requiredHeadings ?? [], `${stageId}.md`) },
    { name: 'cited-paths', run: (t) => checkCitedPaths(t, citeRoot, `${stageId}.md`) },
  ]
  if (stageId === '10-prd') return [...common, ...prdChecks(schema)]
  if (stageId === '40-testplan') return [...common, ...testplanChecks(featureDir, schema)]
  // `40-regression` (pipeline bugfix) không dùng được bộ check testplan vì
  // traceability ở đó gắn cứng theo AC, mà bugfix không có AC (spec §4.3). Luật
  // của nó là truy vết theo mục Unchanged behavior của diagnosis.
  if (stageId === '40-regression') return [...common, ...regressionChecks(featureDir)]
  return common
}
