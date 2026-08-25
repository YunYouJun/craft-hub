const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('craftHubDesktop', {
  // Electron's sandbox exposes process as a safe, limited global.
  // eslint-disable-next-line node/prefer-global/process
  platform: process.platform,
})
