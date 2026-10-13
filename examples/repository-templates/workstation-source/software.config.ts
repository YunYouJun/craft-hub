// Literal data is read statically; imports and executable expressions are unnecessary.
export const softwareGroups = [
  {
    id: 'development',
    label: { en: 'Development', zh: '开发工具' },
    items: [
      {
        id: 'example-tool',
        name: { en: 'Example tool', zh: '示例工具' },
        url: 'https://example.com/tool',
        downloadUrl: 'https://example.com/tool/download',
      },
    ],
  },
] as const
