// Nối stage id với bộ check tương ứng, cộng thêm schema/<stageId>.json nếu có.
// checksFor đọc schema một cách phòng thủ (existsSync trước) để một stage
// chưa có schema (hoặc stage lạ không map được prd/testplan) vẫn nhận được
// bộ check dùng chung thay vì throw.
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
