import { describe, expect, it } from 'vitest'
import { createDefaultPersonalWorkbenchHome, isRaycastCommandUrl, personalWorkbenchToolLaunchForUrl, personalWorkbenchToolSchema } from '../src/personal-workbench'

const tool = { id: 'launcher', title: 'Launcher', url: 'https://example.com/', group: 'Tools' }

describe('personal workbench launch contracts', () => {
  it('preserves independent download and source links while retaining a required website', () => {
    const links = { downloadUrl: 'https://downloads.example.com/app', repositoryUrl: 'https://github.com/example/tool' }
    expect(personalWorkbenchToolSchema.parse({ ...tool, ...links })).toEqual({ ...tool, ...links })
    expect(personalWorkbenchToolSchema.parse({ ...tool, downloadUrl: ` ${links.downloadUrl} ` }).downloadUrl).toBe(links.downloadUrl)
    const { url, ...withoutWebsite } = tool
    expect(() => personalWorkbenchToolSchema.parse({ ...withoutWebsite, ...links })).toThrow()
  })

  it.each(['url', 'downloadUrl', 'repositoryUrl'] as const)('applies the same website safety boundary to %s', (field) => {
    for (const value of [
      '',
      'http://example.com/app',
      'javascript:alert(1)',
      'file:///Applications/Tool.app',
      'https://user:password@example.com/app',
      'https://exam\tple.com/app',
      'https://example.com/app\n',
      '\nhttps://example.com/app',
      'https://example.com/app\0',
      'https://example.com/app\x7F',
    ]) {
      expect(personalWorkbenchToolSchema.safeParse({ ...tool, [field]: value }).success).toBe(false)
    }
  })

  it('preserves HTTPS-only website entries and accepts only the known application presets', () => {
    expect(personalWorkbenchToolSchema.parse(tool)).toEqual(tool)
    expect(personalWorkbenchToolSchema.parse({ ...tool, launch: { application: 'orca' } }).launch).toEqual({ application: 'orca' })
    expect(personalWorkbenchToolSchema.parse({ ...tool, launch: { application: 'raycast' } }).launch).toEqual({ application: 'raycast' })
    expect(personalWorkbenchToolSchema.parse({ ...tool, launch: { application: 'ghostty' } }).launch).toEqual({ application: 'ghostty' })
    expect(() => personalWorkbenchToolSchema.parse({ ...tool, launch: { application: 'unknown' } })).toThrow()
    expect(() => personalWorkbenchToolSchema.parse({ ...tool, launch: { application: 'orca', commandUrl: 'orca://project/example' } })).toThrow()
    expect(() => personalWorkbenchToolSchema.parse({ ...tool, launch: { application: 'raycast', command: 'open', args: ['-a', 'Other app'] } })).toThrow()
    expect(() => personalWorkbenchToolSchema.parse({ ...tool, launch: { application: 'raycast' }, url: 'raycast://extensions/example/tools/open' })).toThrow()
  })

  it.each([
    { command: 'sh' },
    { args: ['-e', 'echo hello'] },
    { path: '/project' },
    { commandUrl: 'ghostty://project/example' },
  ])('rejects extra Ghostty launch options %j', (options) => {
    expect(personalWorkbenchToolSchema.safeParse({ ...tool, launch: { application: 'ghostty', ...options } }).success).toBe(false)
  })

  it.each(['https://ghostty.org', 'https://ghostty.org/'])('infers the fixed Ghostty launcher for its official homepage %s', (url) => {
    expect(personalWorkbenchToolLaunchForUrl(url)).toEqual({ application: 'ghostty' })
  })

  it.each([
    'https://ghostty.org/docs',
    'https://ghostty.org/../',
    'https://ghostty.org/?',
    'https://ghostty.org/?command=sh',
    'https://ghostty.org/#',
    'https://ghostty.org/#download',
    'https://user@ghostty.org/',
    'https://user:password@ghostty.org/',
    'https://ghostty.org:443/',
    'https://ghostty.org:8443/',
    'https://www.ghostty.org/',
    'https://ghostty.org.example.com/',
    'https://example.com/',
    'http://ghostty.org/',
    'ghostty://',
    'https://ghostty.org/\n',
    ' https://ghostty.org/',
  ])('does not infer a launcher for other URLs %s', (url) => {
    expect(personalWorkbenchToolLaunchForUrl(url)).toBeUndefined()
  })

  it('accepts the official command route and rejects other Raycast routes or implicit context', () => {
    const commandUrl = 'raycast://extensions/HelloImSteven/pins/view-pins'
    expect(isRaycastCommandUrl(commandUrl)).toBe(true)
    expect(personalWorkbenchToolSchema.parse({ ...tool, launch: { application: 'raycast', commandUrl } }).launch).toEqual({ application: 'raycast', commandUrl })
  })

  it.each([
    'https://extensions/example/tools/open',
    'orca://extensions/example/tools/open',
    'raycast://script-commands/example',
    'raycast://extensions@example/tools/open',
    'raycast://user:password@extensions/example/tools/open',
    'raycast://extensions:80/example/tools/open',
    'raycast://extensions/example/tools/open/extra',
    'raycast://extensions/example/tools/open?launchType=background',
    'raycast://extensions/example/tools/open?arguments=%7B%7D',
    'raycast://extensions/example/tools/open#fragment',
    'raycast://extensions/example/tools/../open',
    'raycast://extensions/example/tools/%0aopen',
    'raycast://extensions/example/tools/open\n',
    'raycast://extensions/exam\tple/tools/open',
    'raycast://extensions/example/tools/open\0',
    ' raycast://extensions/example/tools/open',
  ])('rejects unsupported or unsafe command URL %s', (commandUrl) => {
    expect(isRaycastCommandUrl(commandUrl)).toBe(false)
    expect(() => personalWorkbenchToolSchema.parse({ ...tool, launch: { application: 'raycast', commandUrl } })).toThrow()
  })

  it('returns independent nested launch preferences for each default home', () => {
    const home = createDefaultPersonalWorkbenchHome()
    const raycast = home.tools.find(tool => tool.id === 'raycast')!
    if (raycast.launch?.application === 'raycast')
      raycast.launch.commandUrl = 'raycast://extensions/example/tools/open'

    expect(createDefaultPersonalWorkbenchHome().tools.find(tool => tool.id === 'raycast')?.launch).toEqual({ application: 'raycast' })
    expect(createDefaultPersonalWorkbenchHome().tools.find(tool => tool.id === 'orca')?.launch).toEqual({ application: 'orca' })
    expect(home.tools.some(tool => tool.launch?.application === 'ghostty')).toBe(false)
  })
})
