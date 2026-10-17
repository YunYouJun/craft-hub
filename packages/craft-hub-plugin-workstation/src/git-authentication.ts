import type { EnvironmentSourceCredentials } from 'craft-hub'
import { randomBytes } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const quote = (value: string): string => `'${value.replace(/'/g, '\'\\\'\'')}'`
const client = `const net = require('node:net'); const socket = net.connect(process.env.CRAFT_HUB_GIT_AUTH_SOCKET); let data = ''; socket.setTimeout(15000, () => {socket.destroy();process.exit(1)}); socket.on('error', () => process.exit(1)); socket.on('connect', () => socket.end(JSON.stringify({nonce:process.env.CRAFT_HUB_GIT_AUTH_NONCE,prompt:process.argv[2]})+'\\n')); socket.on('data', chunk => {data += chunk;if(data.length > 20000)process.exit(1)}); socket.on('end', () => {try{const result=JSON.parse(data);if(typeof result.value!=='string')process.exit(1);process.stdout.write(result.value+'\\n')}catch{process.exit(1)}});`

/** Per-attempt Git askpass. Credentials stay in memory and never enter argv, helper files or saved Git configuration. */
export async function gitAuthentication(repository: string, credentials?: EnvironmentSourceCredentials): Promise<{ environment: NodeJS.ProcessEnv, close: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'ch-git-auth-'))
  await chmod(root, 0o700)
  const helper = join(root, 'askpass')
  const script = join(root, 'client.cjs')
  let secret = credentials
  const nonce = randomBytes(32).toString('hex')
  const sockets = new Set<import('node:net').Socket>()
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.setTimeout(15000, () => socket.destroy())
    let data = ''
    socket.on('data', (chunk) => {
      data += chunk
      if (data.length > 4096)
        return socket.destroy()
      if (!data.includes('\n'))
        return
      try {
        const request = JSON.parse(data)
        let matchingHost = false
        try {
          matchingHost = new URL(String(request.prompt).match(/'([^']+)'/)?.[1] ?? '').host === new URL(repository).host
        }
        catch {}
        const value = request.nonce === nonce && matchingHost && typeof request.prompt === 'string' && secret
          ? /^username/i.test(request.prompt) ? secret.username : /^password/i.test(request.prompt) ? secret.token : undefined
          : undefined
        socket.end(JSON.stringify(value === undefined ? {} : { value }))
      }
      catch { socket.end('{}') }
    })
  })
  try {
    await writeFile(script, client, { mode: 0o600 })
    await writeFile(helper, credentials ? `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(process.execPath)} ${quote(script)} "$@"\n` : '#!/bin/sh\nexit 1\n', { mode: 0o700 })
    const socketPath = join(root, 'socket')
    if (credentials) {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(socketPath, () => {
          server.off('error', reject)
          resolve()
        })
      })
    }
    return {
      environment: { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: helper, GCM_INTERACTIVE: credentials ? 'never' : 'auto', CRAFT_HUB_GIT_AUTH_SOCKET: socketPath, CRAFT_HUB_GIT_AUTH_NONCE: nonce },
      close: async () => {
        secret = undefined
        for (const socket of sockets) socket.destroy()
        if (server.listening)
          await new Promise<void>(resolve => server.close(() => resolve()))
        await rm(root, { recursive: true, force: true })
      },
    }
  }
  catch (error) {
    secret = undefined
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
