// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    pnpm: true,
    ignores: [
      'docs/api/**',
      'apps/tauri/.prepared/**',
      'apps/tauri/.tools/**',
      'apps/tauri/src-tauri/target/**',
      'apps/tauri/src-tauri/gen/**',
    ],
  },
)
