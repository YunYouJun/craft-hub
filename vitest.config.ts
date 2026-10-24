import { createRequire } from 'node:module'
import vue from '@vitejs/plugin-vue'
import { configDefaults, defineConfig } from 'vitest/config'

// Resolve the Web app's compiler so a global NODE_PATH cannot supply an older Vue.
const requireFromWeb = createRequire(new URL('./apps/web/package.json', import.meta.url))

export default defineConfig({
  plugins: [vue({ compiler: requireFromWeb('vue/compiler-sfc') })],
  // Native build evidence and local agent checkouts are not test sources for this checkout's release.
  test: { exclude: [...configDefaults.exclude, '**/apps/macos/build/**', '**/apps/macos/.build/**', '**/.claude/worktrees/**', '**/.codex/worktrees/**'] },
})
