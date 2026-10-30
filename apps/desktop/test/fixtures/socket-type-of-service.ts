import { createServer } from 'node:http'
import { Socket } from 'node:net'
import process from 'node:process'

async function main(): Promise<void> {
  const mode = process.argv[2]
  const code = process.argv[3] ?? 'EINVAL'
  const syscall = process.argv[4] ?? 'setTypeOfService'
  let injectedError: Error | undefined
  let calls = 0

  Object.defineProperty(Socket.prototype, 'setTypeOfService', {
    configurable: true,
    writable: true,
    value: mode === 'absent'
      ? undefined
      : function (this: Socket) {
        calls++
        injectedError = Object.assign(new Error(`${syscall} ${code}`), { code, syscall })
        throw injectedError
      },
  })

  let idempotent = false
  if (mode !== 'baseline') {
    const moduleURL = process.env.CRAFT_HUB_TEST_NETWORK_COMPATIBILITY_MODULE
      ?? new URL('../../src/node-network-compatibility.ts', import.meta.url).href
    const { installNodeNetworkCompatibility } = await import(moduleURL)
    installNodeNetworkCompatibility()
    const installed = Reflect.get(Socket.prototype, 'setTypeOfService')
    installNodeNetworkCompatibility()
    idempotent = Reflect.get(Socket.prototype, 'setTypeOfService') === installed
    const duplicateURL = new URL(moduleURL)
    duplicateURL.searchParams.set('fixture', 'duplicate-module')
    const duplicate = await import(duplicateURL.href)
    duplicate.installNodeNetworkCompatibility()
    idempotent &&= Reflect.get(Socket.prototype, 'setTypeOfService') === installed
  }

  if (mode === 'other-error' || mode === 'chainable') {
    const socket = new Socket()
    try {
      const result = Reflect.get(Socket.prototype, 'setTypeOfService').call(socket, 0)
      process.stdout.write(JSON.stringify({ returnedThis: result === socket, calls, idempotent }))
    }
    catch (error) {
      process.stdout.write(JSON.stringify({ sameError: error === injectedError, calls, idempotent }))
    }
    finally {
      socket.destroy()
    }
  }
  else {
    const server = createServer((_request, response) => response.end('fixture response'))
    const deadline = setTimeout(() => process.exit(2), 8000)
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('The loopback server did not bind a TCP port')
      // Affected builtins reach this failure in the real socket write callback, outside this await's rejection path.
      const response = await fetch(`http://127.0.0.1:${address.port}`)
      process.stdout.write(JSON.stringify({
        body: await response.text(),
        calls,
        idempotent,
        methodAbsent: Reflect.get(Socket.prototype, 'setTypeOfService') === undefined,
      }))
    }
    finally {
      clearTimeout(deadline)
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
