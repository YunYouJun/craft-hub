import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { readUsageSamples } from './macos-idle-metrics'

it.runIf(process.platform === 'darwin')('calibrates real libproc CPU units against an independent process.cpuUsage workload', async () => {
  const run = promisify(execFile)
  const directory = await mkdtemp(join(tmpdir(), 'craft-hub-cpu-counter-'))
  const helper = join(directory, 'usage')
  try {
    await run('/usr/bin/xcrun', ['clang', '-O2', resolve('scripts/macos-process-usage.c'), '-o', helper], { timeout: 10000 })
    const child = spawn(process.execPath, ['-e', `
process.send('ready')
process.on('message',()=>{
  const initial=process.cpuUsage()
  const started=performance.now()
  while(performance.now()-started<100){}
  process.send(process.cpuUsage(initial))
})
process.on('disconnect',()=>process.exit(0))
`], { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], shell: false })
    const exit = once(child, 'exit')
    try {
      await once(child, 'message')
      const pid = child.pid!
      const before = readUsageSamples(JSON.parse((await run(helper, [String(pid)])).stdout), [pid])[0]!
      const response = once(child, 'message')
      child.send('burn')
      const [cpu] = await response
      const after = readUsageSamples(JSON.parse((await run(helper, [String(pid)])).stdout), [pid])[0]!
      const kernelNs = after.cpuUserNs + after.cpuSystemNs - before.cpuUserNs - before.cpuSystemNs
      const independentNs = (cpu.user + cpu.system) * 1000
      expect(kernelNs / independentNs).toBeGreaterThan(0.85)
      expect(kernelNs / independentNs).toBeLessThan(1.15)
    }
    finally {
      child.disconnect()
      await exit
    }
  }
  finally { await rm(directory, { recursive: true, force: true }) }
}, 15000)
