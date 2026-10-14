import type { CaptureDraft } from 'craft-hub'

/** Browser-local wall time for reviewable drafts; UTC conversion happens only on save. */
export function localDateTime(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Reject impossible dates and DST gaps instead of letting Date silently normalize them. */
export function captureDueInstant(value: string): string | undefined {
  if (!value)
    return undefined
  const date = new Date(value)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || localDateTime(date) !== value)
    throw new Error('Invalid local date')
  return date.toISOString()
}

function number(text: string): number {
  if (/^\d+$/.test(text))
    return Number(text)
  const digit = (char: string): number => '零一二三四五六七八九'.indexOf(char.replace('两', '二'))
  if (text.includes('十')) {
    const [tens, ones] = text.split('十')
    return (tens ? digit(tens) : 1) * 10 + (ones ? digit(ones) : 0)
  }
  return digit(text)
}

/** Fast offline preview for common Chinese/English deadlines; ambiguous prose stays intact for AI/manual review. */
export function parseQuickCapture(text: string, lists: Array<{ id: string, title: string }>, now = new Date()): CaptureDraft {
  let title = text.trim()
  const warnings: string[] = []
  const list = [...lists].sort((a, b) => b.title.length - a.title.length).find(list => title.includes(`#${list.title}`))
  if (list)
    title = title.replace(`#${list.title}`, '').trim()
  const important = /(?:^|\s)(?:!重要|!important|!高优先级)(?=\s|$)/i.test(title)
  title = title.replace(/(?:^|\s)(?:!重要|!important|!高优先级)(?=\s|$)/i, ' ').trim()
  const dateMatch = /今天|明天|后天|today|tomorrow|(?:下|本)?(?:周|星期)[一二三四五六日天]|\d{4}-\d{2}-\d{2}/i.exec(title)
  let dueLocal: string | null = null
  let remind = false
  if (dateMatch) {
    const date = new Date(now)
    const token = dateMatch[0].toLowerCase()
    if (/^\d{4}/.test(token)) {
      const [year, month, day] = token.split('-').map(Number)
      date.setFullYear(year!, month! - 1, day!)
    }
    else if (['明天', 'tomorrow', '后天'].includes(token)) {
      date.setDate(date.getDate() + (token === '后天' ? 2 : 1))
    }
    else if (/[周星]/.test(token)) {
      const weekday = '一二三四五六日'.indexOf(token.at(-1)!.replace('天', '日'))
      const current = (date.getDay() + 6) % 7
      let offset = weekday - current
      if (token.startsWith('下'))
        offset += 7
      else if (!token.startsWith('本') && offset < 0)
        offset += 7
      date.setDate(date.getDate() + offset)
    }
    const remainder = title.slice(dateMatch.index + dateMatch[0].length)
    const time = /^\s*(?:(上午|早上|下午|晚上|中午)\s*)?([\d零一二两三四五六七八九十]+)(?::(\d{2})|(?:点|时)(半|[\d零一二三四五六七八九十]+分?)?)/.exec(remainder)
    let hour = time ? number(time[2]!) : 23
    const minute = time ? time[3] ? Number(time[3]) : time[4] === '半' ? 30 : time[4] ? number(time[4].replace('分', '')) : 0 : 59
    if (time && ['下午', '晚上', '中午'].includes(time[1] ?? '') && hour < 12)
      hour += 12
    if (time && ['上午', '早上'].includes(time[1] ?? '') && hour === 12)
      hour = 0
    date.setHours(hour, minute, 0, 0)
    const value = localDateTime(date)
    const valid = hour >= 0 && hour < 24 && minute >= 0 && minute < 60
      && date.getHours() === hour && date.getMinutes() === minute
      && (!/^\d{4}/.test(token) || value.startsWith(token))
    if (valid) {
      dueLocal = value
      remind = Boolean(time)
      title = `${title.slice(0, dateMatch.index)}${remainder.slice(time?.[0].length ?? 0)}`.trim().replace(/^[，,：:\s]+/, '')
    }
    else {
      warnings.push('日期或时间无效，请手动调整。')
    }
  }
  if (/每[天周月年]|每个|下个|月底|稍后|今晚|后续|提醒|\n/.test(text))
    warnings.push('包含重复、提醒或模糊时间；请用 AI 理解或手动核对。本次创建一条待办，请核对截止日期与提醒时间。')
  return { title: title || text.trim(), listId: list?.id ?? null, dueLocal, important, remind, notes: '', warnings }
}
