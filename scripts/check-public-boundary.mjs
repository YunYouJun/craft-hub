import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const word = (...parts) => new RegExp(`\\b${parts.join('')}\\b`, 'i')
const phrase = (...parts) => new RegExp(parts.join(''), 'i')
const forbidden = [
  word('w', 'oa'),
  word('t', 'encent'),
  word('lite', 'app'),
  word('u', 'in'),
  word('r', 'tx'),
  word('we', 'com'),
  word('tap', 'd'),
  word('gong', 'feng'),
  word('code', 'buddy'),
  phrase(String.fromCharCode(0x4F01, 0x5FAE)),
  phrase(String.fromCharCode(0x817E, 0x8BAF)),
  phrase(String.fromCharCode(0x5185, 0x7F51)),
  phrase(String.fromCharCode(0x5DE5, 0x8702)),
]

const { stdout } = await execute('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
const paths = stdout.split('\0').filter(Boolean)
const violations = []

for (const path of paths) {
  const bytes = await readFile(path).catch((error) => {
    if (error.code === 'ENOENT')
      return undefined
    throw error
  })
  if (!bytes)
    continue
  if (bytes.includes(0))
    continue
  const lines = bytes.toString('utf8').split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (path.endsWith('pnpm-lock.yaml') && /integrity:/i.test(line))
      continue
    if (forbidden.some(pattern => pattern.test(line)))
      violations.push(`${path}:${index + 1}: ${line.trim()}`)
  }
}

if (violations.length) {
  console.error('Public repository boundary violations found:')
  console.error(violations.join('\n'))
  process.exitCode = 1
}
