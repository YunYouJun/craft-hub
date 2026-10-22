// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    pnpm: true,
    ignores: [
      'docs/api/**',
      'apps/macos/.build/**',
      'apps/macos/build/**',
    ],
  },
)
