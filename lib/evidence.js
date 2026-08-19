// lib/evidence.js
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_ATTEMPTS } from './plan.js'

const DIR = '.evidence'

// FIX review cuối (finding 2): MỖI TIER MỘT FILE.
// Trước đây T1 và T2 cùng ghi `.evidence/<stage>.log` bằng writeFileSync
// (truncate), nên evidence T2 XOÁ SẠCH exit code của T1 — phá đúng §7.4
// ("quét evidence, gặp bất kỳ `Exit status:` khác 0 → stage không thể done"):
// một stage đỏ ở T1 rồi xanh ở T2 trông sạch bong. Tách path theo tier để
// không tier nào ghi đè bằng chứng của tier khác.
export function evidencePath(stageId, tier) {
  if (!tier) throw new Error('evidencePath: thiếu tier (evidence tách riêng theo từng tier)')
  return `${DIR}/${stageId}.${tier}.log`
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
      writeFileSync(join(featureDir, evidencePath(stageId, tier)), lines.join('\n'))
      return evidencePath(stageId, tier)
    },
  }
  return ev
}

// R3 (review cuối): §7.4 nói "quét EVIDENCE, gặp bất kỳ `Exit status:` khác 0
// → stage không thể done" — quét evidence CÓ THẬT trên đĩa, không phải quét
// danh sách tier mà `gate` khai báo. Một `gate: ["t2"]` viết tay từng cho phép
// một stage tới `done` chỉ bằng phán quyết của LLM trong khi
// `.evidence/<stage>.t1.log` vẫn ghi `Exit status: 1`.
export function tiersWithEvidence(featureDir, stageId) {
  let files
  try {
    files = readdirSync(join(featureDir, DIR))
  } catch {
    return [] // chưa có .evidence/ — không có gì để quét
  }
  const prefix = `${stageId}.`
  return files
    .filter((f) => f.startsWith(prefix) && f.endsWith('.log'))
    .map((f) => f.slice(prefix.length, -'.log'.length))
    .filter((tier) => tier && !tier.includes('.'))
    .sort()
}

// Điều 2 — hoàn thành là dữ kiện, không phải lời khai: câu trả lời "tier này
// có sạch không" LUÔN đến từ file trên đĩa, không từ một cờ trong bộ nhớ.
export function hasFailure(featureDir, stageId, tier) {
  const p = join(featureDir, evidencePath(stageId, tier))
  if (!existsSync(p)) return true
  return readFileSync(p, 'utf8')
    .split('\n')
    .some((l) => {
      const m = /^Exit status: (-?\d+)[ \t]*$/.exec(l)
      return m && Number(m[1]) !== 0
    })
}
