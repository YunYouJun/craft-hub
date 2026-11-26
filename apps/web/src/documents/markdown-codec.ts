import type { JSONContent } from '@tiptap/core'

export type CalloutVariant = 'note' | 'tip' | 'important' | 'warning' | 'caution'

interface MarkSpec {
  type: string
  attrs?: Record<string, unknown>
}

interface ParsedListMarker {
  kind: 'bullet' | 'ordered' | 'task'
  indent: number
  text: string
  checked?: boolean
  start?: number
}

const CALLOUT_VARIANTS = new Set<CalloutVariant>(['note', 'tip', 'important', 'warning', 'caution'])
const ESCAPABLE_PUNCTUATION = new Set(['\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!', '|', '~', '"'])
const HTML_LINE_BREAK_TAG = /<br\s*\/?>/gi

function isCalloutVariant(value: string): value is CalloutVariant {
  return CALLOUT_VARIANTS.has(value as CalloutVariant)
}

function normalizeNewlines(input: string): string {
  return input.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

function countLeadingSpaces(line: string): number {
  let count = 0
  while (count < line.length && line[count] === ' ')
    count++
  return count
}

function parseCodeFenceStart(line: string): { char: '`' | '~', length: number, language: string } | undefined {
  const indent = countLeadingSpaces(line)
  if (indent > 3)
    return undefined
  const rest = line.slice(indent)
  const first = rest[0]
  if (first !== '`' && first !== '~')
    return undefined
  let length = 0
  while (length < rest.length && rest[length] === first)
    length++
  if (length < 3)
    return undefined
  const info = rest.slice(length).trim()
  if (first === '`' && info.includes('`'))
    return undefined
  const spaceIndex = info.search(/\s/)
  const language = spaceIndex >= 0 ? info.slice(0, spaceIndex) : info
  return { char: first, length, language }
}

function isClosingFence(line: string, char: '`' | '~', minLength: number): boolean {
  const indent = countLeadingSpaces(line)
  if (indent > 3)
    return false
  const rest = line.slice(indent)
  let count = 0
  while (count < rest.length && rest[count] === char)
    count++
  return count >= minLength && rest.slice(count).trim() === ''
}

function parseAtxHeading(line: string): { level: number, text: string } | undefined {
  const indent = countLeadingSpaces(line)
  if (indent > 3)
    return undefined
  const rest = line.slice(indent)
  let level = 0
  while (level < rest.length && rest[level] === '#' && level < 7)
    level++
  if (level < 1 || level > 6)
    return undefined
  const after = rest.slice(level)
  if (after.length > 0 && after[0] !== ' ' && after[0] !== '\t')
    return undefined
  let text = after.trim()
  while (text.endsWith('#')) {
    const withoutHash = text.slice(0, -1)
    if (withoutHash === '' || withoutHash.endsWith(' ') || withoutHash.endsWith('\t'))
      text = withoutHash.trimEnd()
    else
      break
  }
  return { level, text }
}

function isHorizontalRule(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length < 3)
    return false
  const nonSpaceChars: string[] = []
  for (const ch of trimmed) {
    if (ch !== ' ' && ch !== '\t')
      nonSpaceChars.push(ch)
  }
  if (nonSpaceChars.length < 3)
    return false
  const marker = nonSpaceChars[0]
  if (marker !== '-' && marker !== '*' && marker !== '_')
    return false
  return nonSpaceChars.every(ch => ch === marker)
}

function parseCardLine(line: string): { target: string, label?: string } | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('::card[') || !trimmed.endsWith(']'))
    return undefined
  const inner = trimmed.slice('::card['.length, -1).trim()
  if (!inner)
    return undefined
  let targetEnd = 0
  while (targetEnd < inner.length && !/\s/.test(inner[targetEnd]!))
    targetEnd++
  const target = inner.slice(0, targetEnd)
  if (!target)
    return undefined
  const rest = inner.slice(targetEnd).trim()
  if (!rest)
    return { target }
  if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) {
    const label = rest.slice(1, -1).trim()
    return label ? { target, label } : { target }
  }
  return undefined
}

function parseStandaloneImageLine(line: string): { src: string, alt: string, title?: string } | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('!['))
    return undefined
  const parsed = readMarkdownLinkOrImage(trimmed, 1)
  if (!parsed || parsed.nextIndex !== trimmed.length)
    return undefined
  return {
    src: parsed.href,
    alt: parsed.label,
    ...(parsed.title ? { title: parsed.title } : {}),
  }
}

function parseListMarker(line: string): ParsedListMarker | undefined {
  const indent = countLeadingSpaces(line)
  const rest = line.slice(indent)
  if (!rest)
    return undefined

  const bulletChar = rest[0]
  if ((bulletChar === '-' || bulletChar === '*' || bulletChar === '+') && (rest[1] === ' ' || rest[1] === '\t' || rest.length === 1)) {
    const afterBullet = rest.length === 1 ? '' : rest.slice(2)
    if (afterBullet.startsWith('[ ]') && (afterBullet.length === 3 || afterBullet[3] === ' ' || afterBullet[3] === '\t')) {
      return {
        kind: 'task',
        indent,
        checked: false,
        text: afterBullet.slice(4),
      }
    }
    if ((afterBullet.startsWith('[x]') || afterBullet.startsWith('[X]')) && (afterBullet.length === 3 || afterBullet[3] === ' ' || afterBullet[3] === '\t')) {
      return {
        kind: 'task',
        indent,
        checked: true,
        text: afterBullet.slice(4),
      }
    }
    return {
      kind: 'bullet',
      indent,
      text: afterBullet,
    }
  }

  let digits = ''
  let cursor = 0
  while (cursor < rest.length && cursor < 9 && rest[cursor]! >= '0' && rest[cursor]! <= '9') {
    digits += rest[cursor]
    cursor++
  }
  if (!digits.length)
    return undefined
  const delimiter = rest[cursor]
  if (delimiter !== '.' && delimiter !== ')')
    return undefined
  const afterDelim = rest[cursor + 1]
  if (afterDelim !== undefined && afterDelim !== ' ' && afterDelim !== '\t')
    return undefined
  return {
    kind: 'ordered',
    indent,
    start: Number.parseInt(digits, 10),
    text: rest.slice(cursor + 2),
  }
}

function splitTableCells(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith('|'))
    trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|'))
    trimmed = trimmed.slice(0, -1)

  const cells: string[] = []
  let current = ''
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!
    if (ch === '\\' && i + 1 < trimmed.length && trimmed[i + 1] === '|') {
      current += '|'
      i++
      continue
    }
    if (ch === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current.trim())
  return cells
}

function isTableDelimiterRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('-'))
    return false
  if (!trimmed.includes('|') && !trimmed.startsWith('-') && !trimmed.startsWith(':'))
    return false
  const cells = splitTableCells(trimmed)
  if (!cells.length)
    return false
  return cells.every((cell) => {
    if (!cell)
      return false
    let slice = cell
    if (slice.startsWith(':'))
      slice = slice.slice(1)
    if (slice.endsWith(':'))
      slice = slice.slice(0, -1)
    if (!slice.length)
      return false
    for (const ch of slice) {
      if (ch !== '-')
        return false
    }
    return true
  })
}

function stripBlockquotePrefix(line: string): string {
  const indent = countLeadingSpaces(line)
  const rest = line.slice(indent)
  if (!rest.startsWith('>'))
    return line
  const after = rest.slice(1)
  return after.startsWith(' ') || after.startsWith('\t') ? after.slice(1) : after
}

function findOpeningTag(line: string, tag: 'details' | 'summary'): boolean {
  const trimmed = line.trim().toLowerCase()
  return trimmed === `<${tag}>` || trimmed.startsWith(`<${tag} `) || trimmed.startsWith(`<${tag}>`)
}

function parseDetailsBlock(lines: string[], startIndex: number): { node: JSONContent, nextIndex: number } | undefined {
  const firstTrimmed = lines[startIndex]?.trim() ?? ''
  const lowerFirst = firstTrimmed.toLowerCase()
  if (lowerFirst !== '<details>' && lowerFirst !== '<details open>' && !lowerFirst.startsWith('<details open='))
    return undefined

  const open = lowerFirst.includes('open')
  let depth = 1
  let endIndex = -1
  for (let idx = startIndex + 1; idx < lines.length; idx++) {
    const trimmedLower = lines[idx]!.trim().toLowerCase()
    if (trimmedLower === '<details>' || trimmedLower.startsWith('<details '))
      depth++
    else if (trimmedLower === '</details>')
      depth--
    if (depth === 0) {
      endIndex = idx
      break
    }
  }
  if (endIndex < 0)
    return undefined

  const innerLines = lines.slice(startIndex + 1, endIndex)
  let summary = ''
  let bodyStart = 0
  if (innerLines[0] && findOpeningTag(innerLines[0], 'summary')) {
    const first = innerLines[0].trim()
    const closeIdx = first.toLowerCase().indexOf('</summary>')
    const openEnd = first.indexOf('>')
    if (openEnd >= 0 && closeIdx > openEnd) {
      summary = first.slice(openEnd + 1, closeIdx).trim()
      bodyStart = 1
    }
    else {
      for (let idx = 1; idx < innerLines.length; idx++) {
        if (innerLines[idx]!.trim().toLowerCase().endsWith('</summary>')) {
          summary = innerLines.slice(0, idx + 1).join('\n').replace(/<\/?summary[^>]*>/gi, '').trim()
          bodyStart = idx + 1
          break
        }
      }
    }
  }

  const bodyLines = innerLines.slice(bodyStart)
  const content = parseBlocks(bodyLines)
  return {
    node: {
      type: 'toggleBlock',
      attrs: { summary: summary || 'Toggle', open },
      content: content.length ? content : [{ type: 'paragraph' }],
    },
    nextIndex: endIndex + 1,
  }
}

function isBlockStarter(lines: string[], index: number): boolean {
  const line = lines[index]
  if (line === undefined || line.trim() === '')
    return true
  if (parseCodeFenceStart(line))
    return true
  if (parseAtxHeading(line))
    return true
  if (isHorizontalRule(line))
    return true
  if (parseCardLine(line))
    return true
  if (parseStandaloneImageLine(line))
    return true
  if (parseListMarker(line))
    return true
  if (countLeadingSpaces(line) <= 3 && line.slice(countLeadingSpaces(line)).startsWith('>'))
    return true
  if (lines[index + 1] !== undefined && line.includes('|') && isTableDelimiterRow(lines[index + 1]!))
    return true
  const trimmedLower = line.trim().toLowerCase()
  if (trimmedLower === '<details>' || trimmedLower === '<details open>' || trimmedLower.startsWith('<details open='))
    return true
  return false
}

function readMarkdownLinkOrImage(text: string, bracketStart: number): { label: string, href: string, title?: string, nextIndex: number } | undefined {
  if (text[bracketStart] !== '[')
    return undefined
  let depth = 0
  let labelEnd = -1
  for (let i = bracketStart; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '\\' && i + 1 < text.length) {
      i++
      continue
    }
    if (ch === '[') {
      depth++
    }
    else if (ch === ']') {
      depth--
      if (depth === 0) {
        labelEnd = i
        break
      }
    }
  }
  if (labelEnd < 0 || text[labelEnd + 1] !== '(')
    return undefined

  let parenDepth = 0
  let parenEnd = -1
  let inQuotes = false
  for (let i = labelEnd + 1; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '\\' && i + 1 < text.length) {
      i++
      continue
    }
    if (ch === '"')
      inQuotes = !inQuotes
    if (!inQuotes) {
      if (ch === '(') {
        parenDepth++
      }
      else if (ch === ')') {
        parenDepth--
        if (parenDepth === 0) {
          parenEnd = i
          break
        }
      }
    }
  }
  if (parenEnd < 0)
    return undefined

  const label = text.slice(bracketStart + 1, labelEnd)
  const targetRaw = text.slice(labelEnd + 2, parenEnd).trim()
  if (!targetRaw)
    return undefined

  let href = targetRaw
  let title: string | undefined
  if (targetRaw.endsWith('"')) {
    const lastQuote = targetRaw.lastIndexOf('"', targetRaw.length - 2)
    if (lastQuote > 0 && /\s/.test(targetRaw[lastQuote - 1]!)) {
      const candidateHref = targetRaw.slice(0, lastQuote).trim()
      if (candidateHref) {
        href = candidateHref
        title = targetRaw.slice(lastQuote + 1, -1)
      }
    }
  }
  if (href.startsWith('<') && href.endsWith('>') && href.length >= 2)
    href = href.slice(1, -1)

  return {
    label,
    href,
    ...(title ? { title } : {}),
    nextIndex: parenEnd + 1,
  }
}

function appendTextNode(nodes: JSONContent[], text: string, marks: MarkSpec[]): void {
  if (!text)
    return
  const marksKey = JSON.stringify(marks)
  const prev = nodes.at(-1)
  if (prev && prev.type === 'text' && JSON.stringify(prev.marks ?? []) === marksKey) {
    prev.text = `${prev.text ?? ''}${text}`
    return
  }
  nodes.push({
    type: 'text',
    text,
    ...(marks.length ? { marks: marks.map(mark => ({ ...mark })) } : {}),
  })
}

function findClosingDelimiter(text: string, startIndex: number, delimiter: string): number {
  for (let i = startIndex; i <= text.length - delimiter.length; i++) {
    const ch = text[i]!
    if (ch === '\\' && i + 1 < text.length) {
      i++
      continue
    }
    if (ch === '`') {
      let ticks = 0
      while (i + ticks < text.length && text[i + ticks] === '`')
        ticks++
      const closeIdx = text.indexOf('`'.repeat(ticks), i + ticks)
      if (closeIdx >= 0) {
        i = closeIdx + ticks - 1
        continue
      }
    }
    if (text.startsWith(delimiter, i)) {
      if (delimiter.length === 1 && text[i + 1] === delimiter) {
        i++
        continue
      }
      if (i > startIndex) {
        const inner = text.slice(startIndex, i)
        if (inner.trim().length > 0 && !inner.startsWith(' ') && !inner.endsWith(' '))
          return i
      }
    }
  }
  return -1
}

function isWordCharacter(ch: string | undefined): boolean {
  return Boolean(ch && /[a-z0-9]/i.test(ch))
}

function parseInlineSegment(text: string, activeMarks: MarkSpec[], output: JSONContent[]): void {
  let i = 0
  while (i < text.length) {
    if (text[i] === '\n') {
      output.push({ type: 'hardBreak' })
      i++
      continue
    }

    if (text[i] === '\\' && i + 1 < text.length && ESCAPABLE_PUNCTUATION.has(text[i + 1]!)) {
      appendTextNode(output, text[i + 1]!, activeMarks)
      i += 2
      continue
    }

    if (text[i] === '`') {
      let tickCount = 0
      while (i + tickCount < text.length && text[i + tickCount] === '`')
        tickCount++
      const needle = '`'.repeat(tickCount)
      let searchFrom = i + tickCount
      let closeIndex = -1
      while (searchFrom < text.length) {
        const candidate = text.indexOf(needle, searchFrom)
        if (candidate < 0)
          break
        const beforeOk = candidate === 0 || text[candidate - 1] !== '`'
        const afterOk = candidate + tickCount >= text.length || text[candidate + tickCount] !== '`'
        if (beforeOk && afterOk) {
          closeIndex = candidate
          break
        }
        searchFrom = candidate + 1
      }
      if (closeIndex >= 0) {
        let codeText = text.slice(i + tickCount, closeIndex)
        if (codeText.length >= 2 && codeText.startsWith(' ') && codeText.endsWith(' ') && codeText.trim().length > 0)
          codeText = codeText.slice(1, -1)
        appendTextNode(output, codeText, [...activeMarks, { type: 'code' }])
        i = closeIndex + tickCount
        continue
      }
      appendTextNode(output, needle, activeMarks)
      i += tickCount
      continue
    }

    if (text[i] === '[' && !activeMarks.some(mark => mark.type === 'link')) {
      const link = readMarkdownLinkOrImage(text, i)
      if (link) {
        const linkMarks: MarkSpec[] = [
          ...activeMarks,
          {
            type: 'link',
            attrs: {
              href: link.href,
              target: '_blank',
              rel: 'noopener noreferrer nofollow',
              class: null,
              ...(link.title ? { title: link.title } : {}),
            },
          },
        ]
        parseInlineSegment(link.label, linkMarks, output)
        i = link.nextIndex
        continue
      }
    }

    if (text.startsWith('***', i) || text.startsWith('___', i)) {
      const delim = text.slice(i, i + 3)
      const closeIndex = findClosingDelimiter(text, i + 3, delim)
      if (closeIndex >= 0) {
        parseInlineSegment(text.slice(i + 3, closeIndex), [...activeMarks, { type: 'bold' }, { type: 'italic' }], output)
        i = closeIndex + 3
        continue
      }
    }

    if (text.startsWith('**', i) || text.startsWith('__', i)) {
      const delim = text.slice(i, i + 2)
      const closeIndex = findClosingDelimiter(text, i + 2, delim)
      if (closeIndex >= 0) {
        parseInlineSegment(text.slice(i + 2, closeIndex), [...activeMarks, { type: 'bold' }], output)
        i = closeIndex + 2
        continue
      }
    }

    if (text.startsWith('~~', i)) {
      const closeIndex = findClosingDelimiter(text, i + 2, '~~')
      if (closeIndex >= 0) {
        parseInlineSegment(text.slice(i + 2, closeIndex), [...activeMarks, { type: 'strike' }], output)
        i = closeIndex + 2
        continue
      }
    }

    if (text[i] === '*' || text[i] === '_') {
      const ch = text[i]!
      const allowOpen = ch === '*' || (!isWordCharacter(text[i - 1]) && !/\s/.test(text[i + 1] ?? ' '))
      if (allowOpen) {
        const closeIndex = findClosingDelimiter(text, i + 1, ch)
        if (closeIndex >= 0 && (ch === '*' || !isWordCharacter(text[closeIndex + 1]))) {
          parseInlineSegment(text.slice(i + 1, closeIndex), [...activeMarks, { type: 'italic' }], output)
          i = closeIndex + 1
          continue
        }
      }
    }

    appendTextNode(output, text[i]!, activeMarks)
    i++
  }
}

export function parseInline(text: string): JSONContent[] {
  const output: JSONContent[] = []
  parseInlineSegment(text, [], output)
  return output
}

function parseParagraph(lines: string[], startIndex: number): { node: JSONContent, nextIndex: number } {
  const paragraphLines: string[] = []
  let i = startIndex
  while (i < lines.length) {
    if (i > startIndex && isBlockStarter(lines, i))
      break
    paragraphLines.push(lines[i]!)
    i++
  }

  let joined = ''
  for (let idx = 0; idx < paragraphLines.length; idx++) {
    const line = paragraphLines[idx]!
    if (idx < paragraphLines.length - 1) {
      if (line.endsWith('  '))
        joined += `${line.slice(0, -2)}\n`
      else if (line.endsWith('\\'))
        joined += `${line.slice(0, -1)}\n`
      else
        joined += `${line} `
    }
    else {
      joined += line
    }
  }

  const content = parseInline(joined)
  return {
    node: {
      type: 'paragraph',
      ...(content.length ? { content } : {}),
    },
    nextIndex: i,
  }
}

function parseListBlock(lines: string[], startIndex: number): { node: JSONContent, nextIndex: number } {
  const firstMarker = parseListMarker(lines[startIndex]!)!
  const baseIndent = firstMarker.indent
  const listKind = firstMarker.kind
  const items: JSONContent[] = []
  let i = startIndex

  while (i < lines.length) {
    const marker = parseListMarker(lines[i]!)
    if (!marker || marker.indent < baseIndent)
      break
    if (marker.indent === baseIndent && marker.kind !== listKind)
      break
    if (marker.indent > baseIndent)
      break

    const itemBodyLines: string[] = [marker.text]
    i++

    while (i < lines.length) {
      const nextLine = lines[i]!
      if (nextLine.trim() === '') {
        let lookahead = i + 1
        while (lookahead < lines.length && lines[lookahead]!.trim() === '')
          lookahead++
        if (lookahead >= lines.length) {
          i = lookahead
          break
        }
        const afterBlankIndent = countLeadingSpaces(lines[lookahead]!)
        const afterBlankMarker = parseListMarker(lines[lookahead]!)
        if (afterBlankMarker && afterBlankMarker.indent <= baseIndent)
          break
        if (afterBlankIndent <= baseIndent)
          break
        itemBodyLines.push('')
        i++
        continue
      }

      const nextMarker = parseListMarker(nextLine)
      if (nextMarker && nextMarker.indent <= baseIndent)
        break

      const nextIndent = countLeadingSpaces(nextLine)
      const stripAmount = Math.min(nextIndent, baseIndent + 2)
      itemBodyLines.push(nextLine.slice(stripAmount))
      i++
    }

    const itemContent = parseBlocks(itemBodyLines)
    const normalizedItemContent = itemContent.length
      ? itemContent
      : [{ type: 'paragraph' }]

    if (listKind === 'task') {
      items.push({
        type: 'taskItem',
        attrs: { checked: Boolean(marker.checked) },
        content: normalizedItemContent,
      })
    }
    else {
      items.push({
        type: 'listItem',
        content: normalizedItemContent,
      })
    }
  }

  if (listKind === 'task')
    return { node: { type: 'taskList', content: items }, nextIndex: i }
  if (listKind === 'ordered') {
    return {
      node: {
        type: 'orderedList',
        attrs: { start: firstMarker.start ?? 1 },
        content: items,
      },
      nextIndex: i,
    }
  }
  return { node: { type: 'bulletList', content: items }, nextIndex: i }
}

function parseTableBlock(lines: string[], startIndex: number): { node: JSONContent, nextIndex: number } {
  const headerCells = splitTableCells(lines[startIndex]!)
  const columnCount = headerCells.length
  const rows: JSONContent[] = []

  const makeRow = (cells: string[], isHeader: boolean): JSONContent => {
    const normalizedCells: JSONContent[] = []
    for (let col = 0; col < columnCount; col++) {
      const rawCell = (cells[col] ?? '').replace(HTML_LINE_BREAK_TAG, '\n')
      const inline = parseInline(rawCell)
      normalizedCells.push({
        type: isHeader ? 'tableHeader' : 'tableCell',
        content: [{
          type: 'paragraph',
          ...(inline.length ? { content: inline } : {}),
        }],
      })
    }
    return { type: 'tableRow', content: normalizedCells }
  }

  rows.push(makeRow(headerCells, true))
  let i = startIndex + 2
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '' || !line.includes('|') || isTableDelimiterRow(line))
      break
    rows.push(makeRow(splitTableCells(line), false))
    i++
  }

  return {
    node: { type: 'table', content: rows },
    nextIndex: i,
  }
}

function parseBlockquoteOrCallout(lines: string[], startIndex: number): { node: JSONContent, nextIndex: number } {
  const innerLines: string[] = []
  let i = startIndex
  while (i < lines.length) {
    const line = lines[i]!
    const indent = countLeadingSpaces(line)
    if (indent <= 3 && line.slice(indent).startsWith('>')) {
      innerLines.push(stripBlockquotePrefix(line))
      i++
      continue
    }
    break
  }

  const firstTrimmed = innerLines[0]?.trim() ?? ''
  if (firstTrimmed.startsWith('[!') && firstTrimmed.endsWith(']')) {
    const tag = firstTrimmed.slice(2, -1).toLowerCase()
    if (isCalloutVariant(tag)) {
      const bodyLines = innerLines.slice(1)
      const content = parseBlocks(bodyLines)
      return {
        node: {
          type: 'callout',
          attrs: { variant: tag },
          content: content.length ? content : [{ type: 'paragraph' }],
        },
        nextIndex: i,
      }
    }
  }

  const content = parseBlocks(innerLines)
  return {
    node: {
      type: 'blockquote',
      content: content.length ? content : [{ type: 'paragraph' }],
    },
    nextIndex: i,
  }
}

function parseBlocks(lines: string[]): JSONContent[] {
  const blocks: JSONContent[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      i++
      continue
    }

    const fence = parseCodeFenceStart(line)
    if (fence) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !isClosingFence(lines[i]!, fence.char, fence.length)) {
        codeLines.push(lines[i]!)
        i++
      }
      if (i < lines.length)
        i++
      const codeText = codeLines.join('\n')
      blocks.push({
        type: 'codeBlock',
        attrs: { language: fence.language || null },
        ...(codeText ? { content: [{ type: 'text', text: codeText }] } : {}),
      })
      continue
    }

    const details = parseDetailsBlock(lines, i)
    if (details) {
      blocks.push(details.node)
      i = details.nextIndex
      continue
    }

    const card = parseCardLine(line)
    if (card) {
      blocks.push({
        type: 'pageCard',
        attrs: {
          target: card.target,
          ...(card.label ? { label: card.label } : {}),
        },
      })
      i++
      continue
    }

    if (isHorizontalRule(line)) {
      blocks.push({ type: 'horizontalRule' })
      i++
      continue
    }

    const heading = parseAtxHeading(line)
    if (heading) {
      const inline = parseInline(heading.text)
      blocks.push({
        type: 'heading',
        attrs: { level: heading.level },
        ...(inline.length ? { content: inline } : {}),
      })
      i++
      continue
    }

    if (countLeadingSpaces(line) <= 3 && line.slice(countLeadingSpaces(line)).startsWith('>')) {
      const quote = parseBlockquoteOrCallout(lines, i)
      blocks.push(quote.node)
      i = quote.nextIndex
      continue
    }

    if (lines[i + 1] !== undefined && line.includes('|') && isTableDelimiterRow(lines[i + 1]!)) {
      const table = parseTableBlock(lines, i)
      blocks.push(table.node)
      i = table.nextIndex
      continue
    }

    if (parseListMarker(line)) {
      const list = parseListBlock(lines, i)
      blocks.push(list.node)
      i = list.nextIndex
      continue
    }

    const standaloneImage = parseStandaloneImageLine(line)
    if (standaloneImage) {
      blocks.push({
        type: 'image',
        attrs: {
          src: standaloneImage.src,
          alt: standaloneImage.alt || null,
          title: standaloneImage.title ?? null,
        },
      })
      i++
      continue
    }

    const paragraph = parseParagraph(lines, i)
    blocks.push(paragraph.node)
    i = paragraph.nextIndex
  }

  return blocks
}

/** Convert Markdown body text into a Tiptap/ProseMirror JSON document. */
export function markdownToTiptap(markdown: string): JSONContent {
  const normalized = normalizeNewlines(markdown)
  const blocks = normalized.trim() === '' ? [] : parseBlocks(normalized.split('\n'))
  return {
    type: 'doc',
    content: blocks.length ? blocks : [{ type: 'paragraph' }],
  }
}

function serializeCodeSpan(text: string): string {
  let maxTicks = 0
  let current = 0
  for (const ch of text) {
    if (ch === '`') {
      current++
      if (current > maxTicks)
        maxTicks = current
    }
    else {
      current = 0
    }
  }
  const fence = '`'.repeat(maxTicks + 1)
  const needsPadding = text.startsWith('`') || text.endsWith('`')
  return needsPadding ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`
}

function serializeInline(nodes: JSONContent[] | undefined): string {
  if (!nodes?.length)
    return ''

  let result = ''
  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      result += '  \n'
      continue
    }
    if (node.type !== 'text')
      continue

    const rawText = node.text ?? ''
    const marks = (node.marks ?? []) as MarkSpec[]
    const hasCode = marks.some(mark => mark.type === 'code')
    let segment = hasCode ? serializeCodeSpan(rawText) : rawText

    const linkMark = marks.find(mark => mark.type === 'link')
    const hasBold = marks.some(mark => mark.type === 'bold')
    const hasItalic = marks.some(mark => mark.type === 'italic')
    const hasStrike = marks.some(mark => mark.type === 'strike')

    if (!hasCode) {
      if (hasItalic)
        segment = `*${segment}*`
      if (hasBold)
        segment = `**${segment}**`
      if (hasStrike)
        segment = `~~${segment}~~`
    }

    if (linkMark && typeof linkMark.attrs?.href === 'string') {
      const href = linkMark.attrs.href
      const title = typeof linkMark.attrs?.title === 'string' && linkMark.attrs.title ? ` "${linkMark.attrs.title}"` : ''
      segment = `[${segment}](${href}${title})`
    }

    result += segment
  }
  return result
}

function prefixQuotedLines(text: string, prefix = '> '): string {
  return text
    .split('\n')
    .map(line => (line === '' ? '>' : `${prefix}${line}`))
    .join('\n')
}

function indentContinuation(text: string, firstLinePrefix: string, continuationIndent: string): string {
  const lines = text.split('\n')
  return lines
    .map((line, index) => {
      if (index === 0)
        return `${firstLinePrefix}${line}`
      return line === '' ? '' : `${continuationIndent}${line}`
    })
    .join('\n')
}

const LIST_NODE_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

function serializeListItemBlocks(blocks: JSONContent[]): string {
  const parts: string[] = []
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!
    const serialized = serializeBlock(block)
    if (!serialized && blocks.length > 1)
      continue
    if (index > 0 && parts.length > 0) {
      const separator = LIST_NODE_TYPES.has(block.type ?? '') ? '\n' : '\n\n'
      parts.push(separator + serialized)
    }
    else {
      parts.push(serialized)
    }
  }
  return parts.join('')
}

function serializeListItems(items: JSONContent[] | undefined, kind: 'bullet' | 'ordered' | 'task', start = 1): string {
  if (!items?.length)
    return ''

  const rendered: string[] = []
  for (const [index, item] of items.entries()) {
    const blocks = item.content ?? []
    const itemText = serializeListItemBlocks(blocks)
    let prefix = '- '
    if (kind === 'ordered')
      prefix = `${start + index}. `
    else if (kind === 'task')
      prefix = item.attrs?.checked ? '- [x] ' : '- [ ] '

    const continuationIndent = kind === 'ordered' ? ' '.repeat(prefix.length) : '  '
    rendered.push(indentContinuation(itemText, prefix, continuationIndent))
  }
  return rendered.join('\n')
}

function serializeTable(node: JSONContent): string {
  const rows = node.content ?? []
  if (!rows.length)
    return ''

  const formatRow = (row: JSONContent): string[] => {
    const cells = row.content ?? []
    return cells.map((cell) => {
      const blockText = serializeBlocks(cell.content ?? [])
      return blockText
        .replaceAll('|', '\\|')
        .replaceAll('\n\n', '<br><br>')
        .replaceAll('\n', '<br>')
    })
  }

  const header = formatRow(rows[0]!)
  const columnCount = header.length || 1
  const separator = Array.from<string>({ length: columnCount }).fill('---')
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
  ]
  for (const bodyRow of rows.slice(1)) {
    const cells = formatRow(bodyRow)
    while (cells.length < columnCount)
      cells.push('')
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}

function chooseBacktickFence(codeText: string): string {
  let maxTicks = 2
  let current = 0
  for (const ch of codeText) {
    if (ch === '`') {
      current++
      if (current > maxTicks)
        maxTicks = current
    }
    else {
      current = 0
    }
  }
  return '`'.repeat(maxTicks + 1)
}

function serializeBlock(node: JSONContent): string {
  switch (node.type) {
    case 'paragraph':
      return serializeInline(node.content)

    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? Math.min(6, Math.max(1, node.attrs.level)) : 1
      return `${'#'.repeat(level)} ${serializeInline(node.content)}`.trimEnd()
    }

    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      const code = (node.content ?? []).map(child => child.text ?? '').join('')
      const fence = chooseBacktickFence(code)
      return code ? `${fence}${language}\n${code}\n${fence}` : `${fence}${language}\n${fence}`
    }

    case 'horizontalRule':
      return '---'

    case 'image': {
      const src = typeof node.attrs?.['data-markdown-src'] === 'string'
        ? node.attrs['data-markdown-src']
        : typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
      const title = typeof node.attrs?.title === 'string' && node.attrs.title ? ` "${node.attrs.title}"` : ''
      return `![${alt}](${src}${title})`
    }

    case 'blockquote': {
      const inner = serializeBlocks(node.content ?? [])
      return inner ? prefixQuotedLines(inner) : '>'
    }

    case 'callout': {
      const rawVariant = typeof node.attrs?.variant === 'string' ? node.attrs.variant.toLowerCase() : 'note'
      const variant = isCalloutVariant(rawVariant) ? rawVariant.toUpperCase() : 'NOTE'
      const inner = serializeBlocks(node.content ?? [])
      return inner ? `> [!${variant}]\n${prefixQuotedLines(inner)}` : `> [!${variant}]`
    }

    case 'toggleBlock': {
      const summary = typeof node.attrs?.summary === 'string' && node.attrs.summary.trim() ? node.attrs.summary.trim() : 'Toggle'
      const openAttr = node.attrs?.open ? ' open' : ''
      const inner = serializeBlocks(node.content ?? [])
      return inner
        ? `<details${openAttr}>\n<summary>${summary}</summary>\n\n${inner}\n</details>`
        : `<details${openAttr}>\n<summary>${summary}</summary>\n</details>`
    }

    case 'pageCard': {
      const target = typeof node.attrs?.target === 'string' ? node.attrs.target.trim() : ''
      const rawLabel = typeof node.attrs?.label === 'string' ? node.attrs.label.trim().replaceAll('"', '\'') : ''
      if (!target)
        return ''
      return rawLabel ? `::card[${target} "${rawLabel}"]` : `::card[${target}]`
    }

    case 'bulletList':
      return serializeListItems(node.content, 'bullet')

    case 'orderedList': {
      const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1
      return serializeListItems(node.content, 'ordered', start)
    }

    case 'taskList':
      return serializeListItems(node.content, 'task')

    case 'table':
      return serializeTable(node)

    default:
      return node.content ? serializeBlocks(node.content) : (node.text ?? '')
  }
}

function serializeBlocks(blocks: JSONContent[]): string {
  const rendered: string[] = []
  for (const block of blocks) {
    const serialized = serializeBlock(block)
    if (serialized || blocks.length > 1)
      rendered.push(serialized)
  }
  return rendered.join('\n\n')
}

/** Convert a Tiptap/ProseMirror JSON document back into clean GFM + Craft extension Markdown. */
export function tiptapToMarkdown(doc: JSONContent): string {
  const blocks = doc.content ?? []
  if (!blocks.length)
    return ''
  if (blocks.length === 1 && blocks[0]?.type === 'paragraph' && !blocks[0].content?.length)
    return ''
  return serializeBlocks(blocks)
}

function parseYamlScalar(rawValue: string): string | number | boolean {
  const trimmed = rawValue.trim()
  if (trimmed === 'true')
    return true
  if (trimmed === 'false')
    return false
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed))
    return Number(trimmed)
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\'')))
    return trimmed.slice(1, -1)
  return trimmed
}

function formatYamlScalar(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (value === '' || /[:#[\]{}&*!|>'"%@`,?]/.test(value) || value.trim() !== value)
    return JSON.stringify(value)
  return value
}

/** Serialize frontmatter key-value pairs and body into one raw Markdown string. */
export function formatRawDocument(markdown: string, frontmatter?: Record<string, unknown>): string {
  const entries = Object.entries(frontmatter ?? {}).filter(([, value]) => value !== undefined)
  if (!entries.length)
    return markdown

  const yamlLines: string[] = []
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      if (!value.length) {
        yamlLines.push(`${key}: []`)
      }
      else {
        yamlLines.push(`${key}:`)
        for (const item of value) {
          if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
            yamlLines.push(`  - ${formatYamlScalar(item)}`)
        }
      }
    }
    else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      yamlLines.push(`${key}: ${formatYamlScalar(value)}`)
    }
  }
  if (!yamlLines.length)
    return markdown
  const header = `---\n${yamlLines.join('\n')}\n---`
  return markdown ? `${header}\n\n${markdown}` : `${header}\n`
}

/** Parse optional YAML frontmatter from raw Markdown for browser raw-mode editing. */
export function parseRawDocument(rawContent: string): { frontmatter: Record<string, unknown>, markdown: string } {
  const normalized = normalizeNewlines(rawContent)
  if (!normalized.startsWith('---\n'))
    return { frontmatter: {}, markdown: normalized }

  const closeIndex = normalized.indexOf('\n---', 4)
  if (closeIndex < 0)
    return { frontmatter: {}, markdown: normalized }

  const afterFence = normalized.slice(closeIndex + 4)
  if (afterFence !== '' && !afterFence.startsWith('\n'))
    return { frontmatter: {}, markdown: normalized }

  const yamlSection = normalized.slice(4, closeIndex)
  let markdown = afterFence.startsWith('\n') ? afterFence.slice(1) : afterFence
  if (markdown.startsWith('\n'))
    markdown = markdown.slice(1)

  const frontmatter: Record<string, unknown> = {}
  const lines = yamlSection.split('\n')
  let activeArrayKey: string | undefined
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#'))
      continue
    if (activeArrayKey && /^\s+-\s+/.test(line)) {
      const itemText = line.replace(/^\s+-\s+/, '')
      const list = (frontmatter[activeArrayKey] as unknown[]) ?? []
      list.push(parseYamlScalar(itemText))
      frontmatter[activeArrayKey] = list
      continue
    }
    activeArrayKey = undefined
    const colonIndex = line.indexOf(':')
    if (colonIndex <= 0)
      continue
    const key = line.slice(0, colonIndex).trim()
    const rawVal = line.slice(colonIndex + 1).trim()
    if (!key)
      continue
    if (rawVal === '') {
      frontmatter[key] = []
      activeArrayKey = key
    }
    else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      const inner = rawVal.slice(1, -1).trim()
      frontmatter[key] = inner ? inner.split(',').map(part => parseYamlScalar(part)) : []
    }
    else {
      frontmatter[key] = parseYamlScalar(rawVal)
    }
  }
  return { frontmatter, markdown }
}
