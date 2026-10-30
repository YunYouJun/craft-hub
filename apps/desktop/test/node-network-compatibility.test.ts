import { execFile } from 'node:child_process'
import { Socket } from 'node:net'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const fixture = fileURLToPath(new URL('./fixtures/socket-type-of-service.ts', import.meta.url))
const moduleURL = new URL('../src/node-network-compatibility.ts', import.meta.url).href
const supportsSocketHint = typeof Reflect.get(Socket.prototype, 'setTypeOfService') === 'function'

async function run(mode: string, code?: string, syscall?: string): Promise<{ code: string | number, stdout: string, stderr: string }> {
  return await new Promise((resolve) => {
    execFile(process.execPath, ['--import', 'tsx', fixture, mode, ...(code ? [code] : []), ...(syscall ? [syscall] : [])], {
      env: { ...process.env, CRAFT_HUB_TEST_NETWORK_COMPATIBILITY_MODULE: moduleURL },
      timeout: 10000,
    }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }))
  })
}

it.runIf(process.platform === 'darwin' && supportsSocketHint)('keeps real fetch working whether the builtin applies or skips optional socket hints', async () => {
  const baseline = await run('baseline')
  if (baseline.code === 0) {
    // Fixed builtins may skip an unset hint or already catch the optional socket error.
    expect(JSON.parse(baseline.stdout)).toMatchObject({ body: 'fixture response' })
  }
  else {
    expect(baseline.stderr).toContain('setTypeOfService EINVAL')
    expect(baseline.stderr).toContain('node:internal/deps/undici/undici')
  }

  const guarded = await run('guarded')
  expect(guarded.stderr).toBe('')
  expect(guarded.code).toBe(0)
  const result = JSON.parse(guarded.stdout)
  expect(result).toEqual({ body: 'fixture response', calls: expect.any(Number), idempotent: true, methodAbsent: false })
  expect(Number.isInteger(result.calls)).toBe(true)
  expect(result.calls).toBeGreaterThanOrEqual(baseline.code === 0 ? 0 : 1)
}, 15000)

it.runIf(process.platform === 'darwin')('preserves other errors and the original error object', async () => {
  for (const [code, syscall] of [['EACCES', 'setTypeOfService'], ['EINVAL', 'connect'], ['ERR_INVALID_ARG_TYPE', 'setTypeOfService']]) {
    const result = await run('other-error', code, syscall)
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ sameError: true, calls: 1, idempotent: true })
  }
}, 15000)

it.runIf(process.platform === 'darwin')('preserves the socket chaining contract when an unsupported hint is ignored', async () => {
  const result = await run('chainable')
  expect(result.code).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ returnedThis: true, calls: 1, idempotent: true })
})

it('leaves runtimes without the socket hint method unchanged and able to fetch', async () => {
  const result = await run('absent')
  expect(result.stderr).toBe('')
  expect(result.code).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ body: 'fixture response', calls: 0, idempotent: true, methodAbsent: true })
})
