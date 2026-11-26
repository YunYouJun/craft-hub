import { describe, expect, it } from 'vitest'
import { formatRawDocument, markdownToTiptap, parseRawDocument, tiptapToMarkdown } from './markdown-codec'

describe('markdown codec', () => {
  it('handles empty documents cleanly', () => {
    const doc = markdownToTiptap('')
    expect(doc.type).toBe('doc')
    expect(doc.content).toEqual([{ type: 'paragraph' }])
    expect(tiptapToMarkdown(doc)).toBe('')
  })

  it('round-trips headings, inline marks, links, hard breaks, code blocks, and dividers', () => {
    const source = [
      '# 灵感与创作工作区',
      '',
      '这是一段包含 **粗体**、*斜体*、~~删除线~~、`inline()` 与 [链接](https://example.com) 的中文正文。  ',
      '下一行通过 hard break 紧接。',
      '',
      '下划线变量 foo_bar_baz 不应触发斜体。',
      '',
      '```ts',
      'export const greet = (name: string) => `hello ` + name',
      '```',
      '',
      '---',
      '',
      '![示例封面](./assets/cover.png)',
    ].join('\n')

    const json = markdownToTiptap(source)
    const serialized = tiptapToMarkdown(json)
    expect(serialized).toBe(source)
    expect(tiptapToMarkdown(markdownToTiptap(serialized))).toBe(serialized)
  })

  it('round-trips bullet, ordered, task, and nested lists', () => {
    const source = [
      '- 第一项',
      '  - 子项 A',
      '  - 子项 B',
      '- 第二项',
      '',
      '1. 步骤一',
      '2. 步骤二',
      '',
      '- [ ] 待办未完成',
      '- [x] 待办已完成',
    ].join('\n')

    const serialized = tiptapToMarkdown(markdownToTiptap(source))
    expect(serialized).toBe(source)
    expect(tiptapToMarkdown(markdownToTiptap(serialized))).toBe(serialized)
  })

  it('round-trips Craft callouts, toggle sections, blockquotes, and subpage cards', () => {
    const source = [
      '> [!NOTE]',
      '> 本地文件是唯一的事实来源。',
      '>',
      '> 支持多段提示内容。',
      '',
      '> 普通引用文本',
      '',
      '<details>',
      '<summary>展开查看分镜草案</summary>',
      '',
      '- 镜号 01：开场',
      '- 镜号 02：主界面演示',
      '</details>',
      '',
      '::card[./launch-notes.md]',
      '',
      '::card[./script/draft.md "脚本定稿"]',
    ].join('\n')

    const doc = markdownToTiptap(source)
    const blockTypes = (doc.content ?? []).map(node => node.type)
    expect(blockTypes).toEqual(['callout', 'blockquote', 'toggleBlock', 'pageCard', 'pageCard'])

    const serialized = tiptapToMarkdown(doc)
    expect(serialized).toBe(source)
    expect(tiptapToMarkdown(markdownToTiptap(serialized))).toBe(serialized)
  })

  it('round-trips GFM tables and multi-backtick code fences without corrupting content', () => {
    const source = [
      '| 渠道 | 状态 | 备注 |',
      '| --- | --- | --- |',
      '| B站 | ready | 16:9 横屏 |',
      '| 小红书 | draft | 包含 \\| 竖线 |',
      '',
      '````md',
      '```ts',
      'const nested = true',
      '```',
      '````',
      '',
      '行内 ``a ` b`` 代码',
    ].join('\n')

    const serialized = tiptapToMarkdown(markdownToTiptap(source))
    expect(serialized).toBe(source)
  })

  it('round-trips frontmatter metadata and body in raw document helpers', () => {
    const formatted = formatRawDocument('# Title\n\nBody', {
      title: 'Title',
      status: 'draft',
      tags: ['daily', 'ideas'],
      archived: false,
    })
    const parsed = parseRawDocument(formatted)
    expect(parsed.frontmatter).toEqual({
      title: 'Title',
      status: 'draft',
      tags: ['daily', 'ideas'],
      archived: false,
    })
    expect(parsed.markdown).toBe('# Title\n\nBody')
  })
})
