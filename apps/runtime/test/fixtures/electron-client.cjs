const { spawn } = require('node:child_process')
const { readFileSync } = require('node:fs')
const process = require('node:process')
// Real, isolated Electron main used only by verify-shared-runtime-macos.ts.
const { app, BrowserWindow } = require('electron')

const option = process.argv.find(value => value.startsWith('--runtime-fixture='))
const config = JSON.parse(readFileSync(option.slice('--runtime-fixture='.length), 'utf8'))
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  await window.loadURL('data:text/html,<title>Runtime fixture</title>')
  const child = spawn(config.client, ['call', config.service, config.serverRequirement, JSON.stringify({ method: 'hello', protocol: 1 })], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', data => output += data)
  child.on('exit', (code) => {
    process.stdout.write(output)
    process.stdout.write(`${JSON.stringify({ event: 'electron-processes', pids: app.getAppMetrics().map(metric => metric.pid) })}\n`)
    process.exitCode = code || 0
    setTimeout(() => {
      window.close()
      app.quit()
    }, 250)
  })
})
