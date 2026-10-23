/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import MarkdownPreview from './MarkdownPreview.vue'

const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const probe = 'window.__markdownPreviewExecuted = true'
let host: HTMLDivElement
let wrapper: ReturnType<typeof mount> | undefined

function render(content: string, props: { projectId?: string, assetUrl?: (path: string) => string } = {}): ReturnType<typeof mount> {
  wrapper = mount(MarkdownPreview, {
    attachTo: host,
    props: { content, readmePath: 'docs/README.md', ...props },
  })
  return wrapper
}

function expectInertContent(): void {
  expect(host.querySelector('script, iframe, object, embed, style, svg, math')).toBeNull()
  for (const element of host.querySelectorAll('*')) {
    for (const attribute of element.attributes)
      expect(attribute.name).not.toMatch(/^on/i)
  }
  expect(Reflect.get(window, '__markdownPreviewExecuted')).toBe(false)
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  Reflect.set(window, '__markdownPreviewExecuted', false)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  host.remove()
  Reflect.deleteProperty(window, '__markdownPreviewExecuted')
  Reflect.deleteProperty(window, 'craftHubDesktop')
})

describe('Markdown preview browser security', () => {
  it('runs inline handlers in the control, but strips load, error and click handlers from the preview', async () => {
    // Prove the browser can execute the payload: a CSP or a simulated DOM must
    // not make the security assertion pass without exercising the sanitizer.
    const control = document.createElement('button')
    control.setAttribute('onclick', probe)
    host.append(control)
    control.click()
    expect(Reflect.get(window, '__markdownPreviewExecuted')).toBe(true)
    control.remove()
    Reflect.set(window, '__markdownPreviewExecuted', false)

    render(`<img alt="Loaded" src="${pixel}" onload="${probe}" onerror="${probe}">
<button onclick="${probe}">Read safely</button>`)
    const image = host.querySelector('img')!
    await expect.poll(() => image.complete && image.naturalWidth === 1).toBe(true)
    image.dispatchEvent(new Event('error'))
    await page.getByRole('button', { name: 'Read safely' }).click()
    expectInertContent()
  })

  it.each([
    ['entity-encoded JavaScript', `jav&#x61;script:${probe}`],
    ['mixed-case JavaScript', `JaVaScRiPt:${probe}`],
    ['tab-obfuscated JavaScript', `java&#x09;script:${probe}`],
    ['newline-obfuscated JavaScript', `java&#x0a;script:${probe}`],
    ['leading-whitespace JavaScript', ` &#x0d; javascript:${probe}`],
    ['HTML data URL', `data:text/html,<script>${probe}</script>`],
  ])('disables %s links without calling the desktop bridge', async (_name, href) => {
    const openProjectEvidenceInEditor = vi.fn(async () => {})
    window.craftHubDesktop = { openProjectEvidenceInEditor }
    const preview = render(`<a href="${href}">Unsafe link</a>`, { projectId: 'project' })
    const link = host.querySelector('a')!
    expect(link.getAttribute('href')).toMatch(/^#?$/)
    expect(link.hasAttribute('data-local-path')).toBe(false)
    await page.getByRole('link', { name: 'Unsafe link' }).click({ force: true })
    expect(openProjectEvidenceInEditor).not.toHaveBeenCalled()
    expect(preview.emitted('navigateDocument')).toBeUndefined()
    expectInertContent()
  })

  it.each([
    ['SVG foreign content', `<svg><foreignObject><img src="${pixel}" onload="${probe}"></foreignObject></svg>`],
    ['MathML parser mutation', `<math><mtext><table><mglyph><style><!--</style><img title="--><img src='${pixel}' onload='${probe}'>">`],
    ['SVG style parser mutation', `<svg></p><style><a id="</style><img src='${pixel}' onload='${probe}'>">`],
    ['nested raw text', `<noscript><p title="</noscript><img src='${pixel}' onload='${probe}'>">`],
  ])('keeps %s inert after the browser reparses v-html', async (_name, content) => {
    render(`# Document\n\n${content}`)
    await expect.element(page.getByRole('heading', { name: 'Document' })).toBeVisible()
    for (const image of host.querySelectorAll('img')) {
      image.dispatchEvent(new Event('load'))
      image.dispatchEvent(new Event('error'))
    }
    expectInertContent()
  })

  it('removes executable containers and unsafe image sources', () => {
    render(`<script>${probe}</script>
<iframe srcdoc="<script>${probe}</script>"></iframe>
<object data="data:text/html,unsafe"></object><embed src="data:text/html,unsafe">
<img alt="Script" src="javascript:${probe}">
<img alt="SVG" src="data:image/svg+xml,<svg onload='${probe}'></svg>">
<img alt="Outside" src="../../outside.png">`)
    expect(host.querySelectorAll('img')).toHaveLength(3)
    for (const image of host.querySelectorAll('img'))
      expect(image.hasAttribute('src')).toBe(false)
    expectInertContent()
  })

  it('preserves Markdown, safe HTML, inline images, and external link protection', async () => {
    render(`# Guide\n\n**Readable**\n\n![Preview](${pixel})\n\n[Website](https://example.com/guide)\n\n<details><summary>More</summary>Additional instructions</details>`)
    await expect.element(page.getByRole('heading', { name: 'Guide' })).toBeVisible()
    expect(host.querySelector('strong')?.textContent).toBe('Readable')
    const image = host.querySelector('img')!
    await expect.poll(() => image.complete && image.naturalWidth === 1).toBe(true)
    const link = host.querySelector('a')!
    expect(link.href).toBe('https://example.com/guide')
    expect(link.target).toBe('_blank')
    expect(link.rel.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    await page.getByText('More', { exact: true }).click()
    expect(host.querySelector('details')?.open).toBe(true)
    expectInertContent()
  })

  it('keeps project document navigation scoped to the desktop bridge', async () => {
    const openProjectEvidenceInEditor = vi.fn(async () => {})
    window.craftHubDesktop = { openProjectEvidenceInEditor }
    render('[Configuration](./configuration.md)', { projectId: 'project/id' })
    await page.getByRole('link', { name: 'Configuration' }).click()
    expect(openProjectEvidenceInEditor).toHaveBeenCalledExactlyOnceWith('project/id', 'docs/configuration.md')
    expectInertContent()
  })

  it('does not accept document-authored local navigation metadata', async () => {
    const openProjectEvidenceInEditor = vi.fn(async () => {})
    window.craftHubDesktop = { openProjectEvidenceInEditor }
    const preview = render(`<a href="javascript:${probe}" data-local-path="../../outside.md">Forged</a>
<a href="https://example.com/" data-local-path="../../outside.md">Website</a>
<a href="#section" data-local-path="../../outside.md">Section</a>`, { projectId: 'project' })
    expect(host.querySelector('[data-local-path]')).toBeNull()
    await page.getByRole('link', { name: 'Forged' }).click({ force: true })
    await page.getByRole('link', { name: 'Section' }).click()
    expect(openProjectEvidenceInEditor).not.toHaveBeenCalled()
    expect(preview.emitted('navigateDocument')).toBeUndefined()
    expectInertContent()
  })

  it('keeps plugin assets and document navigation usable across content changes', async () => {
    const assetUrl = vi.fn(() => pixel)
    const preview = render('![Preview](./assets/preview.gif)\n\n[Guide](./guide.md)', { assetUrl })
    expect(assetUrl).toHaveBeenCalledWith('docs/assets/preview.gif')
    expect(host.querySelector('img')?.referrerPolicy).toBe('no-referrer')
    await page.getByRole('link', { name: 'Guide' }).click()
    expect(preview.emitted('navigateDocument')).toEqual([['docs/guide.md']])
    await preview.setProps({ content: `<button onclick="${probe}">Next document</button>` })
    await page.getByRole('button', { name: 'Next document' }).click()
    expectInertContent()
  })
})
