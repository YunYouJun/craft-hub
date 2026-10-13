import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cargoHome = resolve(appDir, '.tools/cargo')
const rustupHome = resolve(appDir, '.tools/rustup')
const hasLocalTools = await access(resolve(cargoHome, 'bin/cargo')).then(() => true, () => false)
const env = hasLocalTools
  ? { ...process.env, CARGO_HOME: cargoHome, RUSTUP_HOME: rustupHome, PATH: `${cargoHome}/bin:${process.env.PATH ?? ''}` }
  : process.env

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: appDir, env, shell: false, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed with exit code ${code}`)))
  })
}

await run(process.execPath, ['scripts/prepare-backend.mjs'])
await run(resolve(appDir, 'node_modules/.bin/tauri'), process.argv.slice(2))
