import type { ConfigurationManagementItem, ConfigurationSkillsAudit } from 'craft-hub'

const managers = new Set(['workstation', 'apm', 'skills-cli', 'native-plugin', 'project', 'external', 'unknown'])
const unavailableMessage = 'Skills audit is unavailable in this Workstation version. Update the local CLI to enable diagnostics.'
const failedMessage = 'Workstation could not complete Skills audit. Refresh and check the local CLI.'
const invalidMessage = 'Workstation Skills audit response is invalid. Update the local CLI and refresh.'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, limit: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > limit)
    return false
  for (const character of value) {
    const code = character.charCodeAt(0)
    if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127)
      return false
  }
  return true
}

/** Preserve the existing item contract while accepting only proven display metadata. */
export function configurationItems(value: unknown): ConfigurationManagementItem[] {
  if (!Array.isArray(value))
    return value as ConfigurationManagementItem[]
  return value.map((item: ConfigurationManagementItem) => {
    if (!record(item))
      return item
    const { client: _client, scope: _scope, manager: _manager, provenance: _provenance, ...existing } = item
    return {
      ...existing,
      ...(text(item.client, 128) ? { client: item.client } : {}),
      ...(item.scope === 'global' || item.scope === 'project' ? { scope: item.scope } : {}),
      ...(item.manager !== undefined ? { manager: typeof item.manager === 'string' && managers.has(item.manager) ? item.manager : 'unknown' } : {}),
      ...(record(item.provenance) && text(item.provenance.label, 512)
        ? { provenance: { label: item.provenance.label, ...(text(item.provenance.path, 4096) ? { path: item.provenance.path } : {}) } }
        : {}),
    }
  })
}

/** Invalid diagnostics must never hide an otherwise usable configuration inventory. */
export function skillsAudit(value: unknown): ConfigurationSkillsAudit {
  if (value === undefined)
    return { state: 'unsupported', findings: [], message: unavailableMessage }
  const invalid: ConfigurationSkillsAudit = { state: 'error', findings: [], message: invalidMessage }
  if (!record(value) || (value.state !== 'available' && value.state !== 'error' && value.state !== 'unsupported'))
    return invalid
  if (value.checkedAt !== undefined && (!text(value.checkedAt, 80) || !/^\d{4}-\d{2}-\d{2}T/.test(value.checkedAt) || !Number.isFinite(Date.parse(value.checkedAt))))
    return invalid
  if (!Array.isArray(value.findings) || value.findings.length > 1000)
    return invalid
  if (value.state !== 'available') {
    return {
      state: value.state,
      ...(value.checkedAt ? { checkedAt: value.checkedAt as string } : {}),
      findings: [],
      message: value.state === 'error' ? failedMessage : unavailableMessage,
    }
  }
  const findings: ConfigurationSkillsAudit['findings'] = []
  for (const finding of value.findings) {
    if (!record(finding) || !text(finding.code, 128) || !text(finding.message, 2000) || (finding.severity !== 'warning' && finding.severity !== 'error')
      || !Array.isArray(finding.paths) || finding.paths.length > 20 || !finding.paths.every(path => text(path, 4096))) {
      return invalid
    }
    findings.push({ code: finding.code, severity: finding.severity, message: finding.message, paths: [...finding.paths] })
  }
  let summary: ConfigurationSkillsAudit['summary']
  if (value.summary !== undefined) {
    if (!record(value.summary))
      return invalid
    const { skillFileCount, implicitSkillCount, explicitOnlySkillCount, warningCount, errorCount } = value.summary
    if (![skillFileCount, implicitSkillCount, explicitOnlySkillCount, warningCount, errorCount].every(count => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && count <= 1000000))
      return invalid
    summary = { skillFileCount, implicitSkillCount, explicitOnlySkillCount, warningCount, errorCount } as ConfigurationSkillsAudit['summary']
  }
  if (value.message !== undefined && !text(value.message, 2000))
    return invalid
  return {
    state: 'available',
    ...(value.checkedAt ? { checkedAt: value.checkedAt as string } : {}),
    ...(summary ? { summary } : {}),
    findings,
    ...(text(value.message, 2000) ? { message: value.message } : {}),
  }
}
