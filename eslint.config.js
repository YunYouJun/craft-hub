// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    pnpm: true,
    rules: {
      // Preserve the repository's compact object/array formatting across the config's major upgrade.
      'antfu/reasonable-newline': 'off',
    },
    ignores: [
      'docs/api/**',
      'apps/macos/.build/**',
      'apps/macos/build/**',
    ],
  },
)
