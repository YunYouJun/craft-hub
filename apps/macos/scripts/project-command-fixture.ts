import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
let processHelper: Promise<string> | undefined

async function processInspector(): Promise<string> {
  processHelper ??= (async () => {
    const source = fileURLToPath(new URL('./command-fixture-processes.c', import.meta.url))
    const hash = createHash('sha256').update(await readFile(source)).digest('hex').slice(0, 16)
    const directory = fileURLToPath(new URL('../build/command-fixture-tools', import.meta.url))
    await mkdir(directory, { recursive: true })
    const executable = join(directory, `processes-${hash}-${process.pid}`)
    await exec('/usr/bin/xcrun', ['clang', '-O2', '-Wall', '-Wextra', '-Werror', source, '-o', executable], { timeout: 30000 })
    return executable
  })()
  return processHelper
}

/** Recorded process ownership, checked again before signalling and before declaring cleanup complete. */
export interface CommandFixtureProcess { pid: number, parent: number, executable: string, startedAt: string }

/** Inspect process identity without matching or terminating an application by name. */
export async function commandFixtureProcesses(): Promise<CommandFixtureProcess[]> {
  const { stdout } = await exec(await processInspector(), [], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 })
  return JSON.parse(stdout) as CommandFixtureProcess[]
}

/** A PID alone never authorizes signalling a replacement process. */
export async function commandFixtureSignal(recorded: CommandFixtureProcess, signal: NodeJS.Signals): Promise<boolean> {
  const current = (await commandFixtureProcesses()).find(item => item.pid === recorded.pid)
  if (!current || current.executable !== recorded.executable || current.startedAt !== recorded.startedAt)
    return false
  process.kill(recorded.pid, signal)
  return true
}

/** Create only local, deterministic command declarations and a terminal fixture; no real project is touched. */
export async function prepareCommandFixture(root: string): Promise<{ project: string, marker: string }> {
  const project = join(root, 'project')
  await mkdir(join(project, '.craft-hub'), { recursive: true })
  await writeFile(join(project, 'package.json'), JSON.stringify({
    name: 'native-project-command-fixture',
    private: true,
    scripts: { inspect: 'node command-fixture.mjs inspect', terminal: 'node command-fixture.mjs terminal', heartbeat: 'node command-fixture.mjs heartbeat', editor: 'node command-fixture.mjs editor' },
  }, null, 2))
  await writeFile(join(project, '.craft-hub/project.jsonc'), JSON.stringify({
    version: 1,
    project: { name: 'Native Command Acceptance' },
    capabilities: {
      inputs: {
        'package.json:inspect': {
          message: { type: 'text', label: { 'default': 'Message', 'zh-CN': '消息' }, flag: '--message', argumentStyle: 'separate', required: true },
          mode: { type: 'select', label: { 'default': 'Mode', 'zh-CN': '模式' }, flag: '--mode', options: ['alpha', 'beta'], default: 'alpha' },
          verbose: { type: 'boolean', label: { 'default': 'Verbose', 'zh-CN': '详细输出' }, flag: '--verbose', default: 'false' },
        },
      },
      descriptions: {
        'package.json:inspect': { 'default': 'Print exact argv and cwd once; no shell interpolation.', 'zh-CN': '打印参数和工作目录；仅写入验收夹具记录。' },
        'package.json:terminal': { 'default': 'Interactive terminal: type a line or exit; reports terminal resize.', 'zh-CN': '交互终端：输入一行或 exit，报告终端尺寸变化。' },
        'package.json:heartbeat': { 'default': 'Print a heartbeat until explicitly stopped.', 'zh-CN': '持续输出心跳，直到明确停止。' },
        'package.json:editor': { 'default': 'Open a read-only system Vim with no user configuration or swap file.', 'zh-CN': '用系统 Vim 只读查看本地夹具，不读取用户配置或生成交换文件。' },
      },
    },
  }, null, 2))
  await writeFile(join(project, 'command-fixture.mjs'), [
    'import { appendFileSync } from "node:fs"',
    'import { spawn } from "node:child_process"',
    'import { createInterface } from "node:readline"',
    'const [mode, ...args] = process.argv.slice(2)',
    'appendFileSync(new URL("executions.jsonl", import.meta.url), JSON.stringify({ mode, args, cwd: process.cwd(), pid: process.pid }) + "\\n")',
    'console.log("fixture-cwd:" + process.cwd())',
    'console.error("fixture-stderr:" + mode)',
    'if (mode === "inspect") {',
    '  console.log("fixture-argv:" + JSON.stringify(args))',
    '  console.log("\\x1b[32mfixture-complete\\x1b[0m")',
    '} else if (mode === "terminal") {',
    '  console.log("\\x1b[36mfixture-terminal-ready\\x1b[0m")',
    '  process.stdout.on("resize", () => console.log("fixture-size:" + process.stdout.columns + "x" + process.stdout.rows))',
    '  const input = createInterface({ input: process.stdin, output: process.stdout, terminal: true })',
    '  input.on("line", line => {',
    '    console.log("fixture-echo:" + line)',
    '    if (line === "exit") { input.close(); process.exit(0) }',
    '  })',
    '} else if (mode === "heartbeat") {',
    '  let count = 0',
    '  console.log("fixture-heartbeat-ready")',
    '  setInterval(() => console.log("fixture-heartbeat:" + ++count), 1000)',
    '} else if (mode === "editor") {',
    '  const editor = spawn("/usr/bin/vim", ["-u", "NONE", "-i", "NONE", "-n", "-R", "terminal-document.txt"], { stdio: "inherit" })',
    '  editor.on("exit", code => { process.exitCode = code ?? 1 })',
    '  editor.on("error", () => { process.exitCode = 1 })',
    '}',
  ].join('\n'))
  await writeFile(join(project, 'terminal-document.txt'), [
    'SwiftTerm native terminal acceptance',
    'Unicode: 中文输入、光标与滚动 / café / 🐈',
    'This is a read-only fixture. Use j/k or arrows to move, then :q! to exit.',
    ...Array.from({ length: 80 }, (_, index) => `Line ${index + 1}: native runtime PTY, no second command runner.`),
  ].join('\n'))
  await mkdir(join(project, 'packages/worker'), { recursive: true })
  await writeFile(join(project, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  await writeFile(join(project, 'packages/worker/package.json'), JSON.stringify({
    name: 'terminal-directory-fixture',
    private: true,
    scripts: { 'workspace-cwd': 'node ../../command-fixture.mjs inspect' },
  }, null, 2))
  return { project: await realpath(project), marker: join(project, 'executions.jsonl') }
}

/** Verify only this disposable fixture's explicit process-start records. */
export async function commandFixtureExecutions(marker: string): Promise<Array<{ mode: string, args: string[], cwd: string, pid: number }>> {
  const text = await readFile(marker, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT')
      return ''
    throw error
  })
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

/** Run the exact packaged sidecar under a temporary HOME/profile, with credentials confined to memory. */
export async function withCommandFixtureSidecar<T>(app: string, root: string, operation: (connection: { origin: string, headers: Record<string, string>, request: (path: string, method?: string, body?: unknown) => Promise<Response> }) => Promise<T>): Promise<T> {
  const home = join(root, 'home')
  await mkdir(home, { recursive: true })
  const sidecar = join(app, 'Contents/Resources/app/apps/desktop/dist/sidecar.mjs')
  const child = spawn(process.execPath, [sidecar], {
    cwd: home,
    env: { HOME: home, CRAFT_HUB_SIDECAR_DIR: join(root, 'profile'), PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, LANG: 'C.UTF-8', CRAFT_HUB_CLOUD_ENDPOINT: '', CRAFT_HUB_CLOUD_ORIGIN: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  })
  let recorded: CommandFixtureProcess | undefined
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-8192)
  })
  let shutdown: Promise<void> | undefined
  const cleanup = async () => {
    const rows = await commandFixtureProcesses()
    recorded ??= rows.find(item => item.pid === child.pid && item.parent === process.pid && item.executable === process.execPath)
    const ownsRoot = recorded && rows.some(item => item.pid === recorded!.pid && item.startedAt === recorded!.startedAt && item.executable === recorded!.executable)
    const descendants = new Set<number>(ownsRoot ? [recorded!.pid] : [])
    for (let index = 0; index < rows.length; index++) {
      for (const row of rows) {
        if (descendants.has(row.parent))
          descendants.add(row.pid)
      }
    }
    const owned = rows.filter(row => descendants.has(row.pid))
    child.stdin.end()
    const exited = child.exitCode === null && child.signalCode === null ? once(child, 'exit').catch(() => {}) : Promise.resolve()
    await Promise.race([exited, delay(8000, undefined, { ref: false })])
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      if (child.exitCode !== null || child.signalCode !== null)
        break
      if (recorded)
        await commandFixtureSignal(recorded, signal)
      await Promise.race([exited, delay(3000, undefined, { ref: false })])
    }
    for (const item of owned.reverse())
      await commandFixtureSignal(item, 'SIGKILL')
    await delay(100)
    const current = await commandFixtureProcesses()
    const remaining = owned.filter(item => current.some(row => row.pid === item.pid && row.executable === item.executable && row.startedAt === item.startedAt))
    await writeFile(join(root, 'sidecar-cleanup.json'), JSON.stringify({ owned, remaining, finishedAt: new Date().toISOString() }, null, 2))
    if (remaining.length)
      throw new Error('A recorded command fixture process did not exit')
  }
  const stop = () => {
    shutdown ??= cleanup()
    return shutdown
  }
  function onSignal() {
    void stop().finally(() => process.exitCode = 130)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    const handshake = await new Promise<{ version: number, url: string, nativeApiToken: string }>((resolve, reject) => {
      let text = ''
      const timer = setTimeout(() => reject(new Error('Packaged command sidecar handshake timed out')), 20000)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error(`Packaged command sidecar exited before handshake: ${stderr}`))
      })
      child.stdout.setEncoding('utf8').on('data', (chunk) => {
        text += chunk
        if (text.length > 16384) {
          clearTimeout(timer)
          reject(new Error('Oversized sidecar handshake'))
        }
        const newline = text.indexOf('\n')
        if (newline >= 0) {
          clearTimeout(timer)
          try {
            resolve(JSON.parse(text.slice(0, newline)))
          }
          catch { reject(new Error('Invalid packaged sidecar handshake')) }
        }
      })
    })
    if (handshake.version !== 1 || !/^[a-f0-9]{64}$/.test(handshake.nativeApiToken))
      throw new Error('Unsupported command sidecar handshake')
    recorded = (await commandFixtureProcesses()).find(item => item.pid === child.pid)
    if (!recorded || await realpath(recorded.executable) !== await realpath(process.execPath))
      throw new Error('Could not establish the packaged sidecar process identity')
    const origin = new URL(handshake.url).origin
    const headers = { origin, 'authorization': `Bearer ${handshake.nativeApiToken}`, 'content-type': 'application/json' }
    const result = await operation({
      origin,
      headers,
      request: (path, method = 'GET', body) => fetch(new URL(path, origin), { headers, method, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(20000) }),
    })
    return result
  }
  finally {
    await stop()
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
  }
}
