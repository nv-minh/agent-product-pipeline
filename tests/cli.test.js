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
