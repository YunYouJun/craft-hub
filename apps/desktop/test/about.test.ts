import { describe, expect, it } from 'vitest'
import { aboutDocument, aboutPanelOptions } from '../src/about.ts'

describe('about Craft Hub panel', () => {
  it('shows complete product and project information', () => {
    expect(aboutPanelOptions('0.0.1-alpha.0', '/assets/icon.png')).toEqual({
      applicationName: 'Craft Hub',
      applicationVersion: '0.0.1-alpha.0',
      version: '0.0.1-alpha.0',
      copyright: 'Copyright © YunYouJun',
      credits: [
        'A local, cross-project developer workbench.',
        '',
        'Open source under the MIT License.',
      ].join('\n'),
      authors: ['YunYouJun'],
      website: 'https://github.com/YunYouJun/craft-hub',
      iconPath: '/assets/icon.png',
    })
  })

  it('renders GitHub as an icon link in the custom about window', () => {
    const document = aboutDocument('0.0.1-alpha.0', 'data:image/png;base64,app-icon')

    expect(document).toContain('href="https://github.com/YunYouJun/craft-hub"')
    expect(document).toContain('class="project-link"')
    expect(document).toContain('<span>GitHub</span>')
    expect(document).not.toContain('>https://github.com/YunYouJun/craft-hub<')
  })

  it('renders downstream product branding without community copy', () => {
    const branding = {
      authors: ['Acme'],
      copyright: 'Copyright © Acme',
      description: 'Acme developer workbench.',
      license: 'Internal distribution.',
      linkLabel: 'Documentation',
      website: 'https://developer.acme.example/workbench',
    }
    const document = aboutDocument('1.2.3', 'data:image/png;base64,app-icon', 'Acme Workbench', branding)

    expect(document).toContain('<title>About Acme Workbench</title>')
    expect(document).toContain('<h1>Acme Workbench</h1>')
    expect(document).toContain('href="https://developer.acme.example/workbench"')
    expect(document).not.toContain('GitHub')
    expect(aboutPanelOptions('1.2.3', '/assets/icon.png', 'Acme Workbench', branding).applicationName).toBe('Acme Workbench')
  })
})
