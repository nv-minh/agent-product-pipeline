import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const REQUIRED_STAGE_FIELDS = ['enabled', 'inputs', 'outputs', 'gate']

function parseInput(raw) {
  const optional = raw.endsWith('?')
  return { path: optional ? raw.slice(0, -1) : raw, optional }
}

function validateStageField(file, id, f, value) {
  if (value === undefined || value === null) {
    throw new Error(`${file}: stage "${id}" thiếu field "${f}"`)
  }
  if (f === 'enabled' && typeof value !== 'boolean') {
    throw new Error(`${file}: stage "${id}" thiếu field "${f}"`)
  }
  if ((f === 'inputs' || f === 'outputs' || f === 'gate') && !Array.isArray(value)) {
    throw new Error(`${file}: stage "${id}" thiếu field "${f}"`)
  }
}

export function readConfig(featureDir) {
  const file = join(featureDir, 'pipeline.json')
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    // ENOENT = feature chưa init hoặc gõ sai tên: nói bằng ngôn ngữ người kèm
    // danh sách feature thật đang có. Thông điệp cũ đổ raw ENOENT (lộ cả đường
    // symlink máy như /private/...) và exit 1 như lỗi runtime, trong khi đây
    // là lỗi đối số — exit 2 như unknown command/stage (lab 2026-08-21).
    if (e.code === 'ENOENT') {
      const cha = dirname(featureDir)
      const có = existsSync(cha)
        ? readdirSync(cha, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
            .map((d) => d.name)
            .sort()
        : []
      const err = new Error(
        `feature "${basename(featureDir)}" không tồn tại (không có pipeline.json ở ${featureDir}). ` +
        (có.length
          ? `Feature hiện có: ${có.join(', ')}.`
          : 'Thư mục features/ chưa có feature nào — pp init <tên> để tạo.'),
      )
      err.exitCode = 2
      throw err
    }
    throw new Error(`không đọc được ${file}: ${e.message}`)
  }
  for (const k of ['feature', 'stages']) {
    if (!raw[k]) throw new Error(`${file}: thiếu field "${k}"`)
  }
  const stages = {}
  for (const [id, s] of Object.entries(raw.stages)) {
    for (const f of REQUIRED_STAGE_FIELDS) {
      validateStageField(file, id, f, s[f])
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
      // pp-bugfix/pp-change: schema override (registry nạp schema/<tên>.json
      // thay vì schema/<stage-id>.json) và ranh giới đọc workspace (advance in
      // thêm một dòng chỉ thị). Cả hai optional — template cũ không đổi hành vi.
      schema: s.schema,
      // FINDING (review 8c825c9..44c1ecb): `?? false` chỉ chặn nullish, nên
      // `"reads_workspace": "no"` (hoặc "false", 0.1) BẬT cờ. Người dùng được
      // phép sửa pipeline.json (§7.7), nên giá trị lạ phải nghiêng về đóng.
      readsWorkspace: s.reads_workspace === true,
    }
  }
  // `type` phân loại pipeline (feature|bugfix|change) cho status/report/audit;
  // `from` là feature gốc mà pp init --from đã liên kết (chỉ type change có),
  // `fromPath` là ĐƯỜNG DẪN đã resolve của nó — slug trần không phân biệt được
  // features/ với _archive/, mà spec §9 nói truy vết đi qua chính field này.
  return {
    feature: raw.feature,
    size: raw.size ?? 'M',
    type: raw.type ?? 'feature',
    from: raw.from,
    fromPath: raw.from_path,
    stages,
  }
}

export function stageOrder(config) {
  return Object.keys(config.stages).sort(
    (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
  )
}
