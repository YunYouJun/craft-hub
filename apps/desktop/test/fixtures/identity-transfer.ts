import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { DeviceVault } from '../../src/device-vault.ts'

// A fake OS adapter with opaque ciphertext and a private key held only in this child process.
async function main(): Promise<void> {
  let secret = ''
  const ciphertext = randomBytes(64)
  const vault = new DeviceVault(process.argv[2]!, {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'fixture',
    encryptString: (value) => {
      secret = value
      return ciphertext
    },
    decryptString: (value) => {
      if (!value.equals(ciphertext))
        throw new Error('Invalid fixture cipher')
      return secret
    },
  }, 'darwin')
  await vault.register(await vault.loadOrCreate(), 'fixture-source-device')
  process.stdout.write('ready\n')
  let input = ''
  for await (const chunk of process.stdin) {
    input += Buffer.from(chunk).toString('utf8')
    if (Buffer.byteLength(input) > 16 * 1024)
      throw new Error('Invalid fixture request')
  }
  const request = JSON.parse(input)
  const result = await vault.sealTransfer(request, { endpoint: 'https://api.example.com', webOrigin: 'https://cloud.example.com' })
  process.stdout.write(JSON.stringify(result))
}
void main().catch(() => {
  process.stderr.write('Identity transfer fixture failed\n')
  process.exitCode = 1
})
