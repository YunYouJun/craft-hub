import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'
import unitConfig from './vitest.config.ts'

export default mergeConfig(unitConfig, defineConfig({
  root: fileURLToPath(new URL('./apps/web', import.meta.url)),
  test: {
    include: ['src/**/*.browser.ts'],
    attachmentsDir: join(tmpdir(), 'craft-hub-browser-attachments'),
    retry: 0,
    browser: {
      enabled: true,
      headless: true,
      screenshotDirectory: join(tmpdir(), 'craft-hub-browser-screenshots'),
      provider: playwright(),
      instances: [
        { browser: 'chromium' },
        { browser: 'firefox' },
        { browser: 'webkit' },
      ],
    },
  },
}))
