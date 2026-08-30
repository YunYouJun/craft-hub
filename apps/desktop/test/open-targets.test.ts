import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { codexCommand, codexThreadUrl, editorTargetPaths, externalHttpUrl, focusCodexApplication, gitRemoteHttpUrl, macTerminalApplication, macTerminalApplications, openCodexProject, openCursorEditor, openCustomEditor, openMacTerminalProject, projectContainsPath, vscodeUrl } from '../src/open-targets.ts'

describe('desktop open targets', () => {
  it('keeps capability source targets inside their resolved project root', () => {
    expect(projectContainsPath('/project', '/project/.agents/skills/release/SKILL.md')).toBe(true)
    expect(projectContainsPath('/project', '/project')).toBe(true)
    expect(projectContainsPath('/project', '/project-copy/SKILL.md')).toBe(false)
    expect(projectContainsPath('/project', '/outside/SKILL.md')).toBe(false)
  })

  it('opens the project workspace before its capability source target', () => {
    expect(editorTargetPaths('/project/.agents/skills/release/SKILL.md', '/project')).toEqual([
      '/project',
      '/project/.agents/skills/release/SKILL.md',
    ])
    expect(editorTargetPaths('/project', '/project')).toEqual(['/project'])
    expect(editorTargetPaths('/project/package.json')).toEqual(['/project/package.json'])
  })

  it('encodes local paths for the VS Code URL handler', () => {
    expect(vscodeUrl('/Users/example/My Project/package.json')).toBe('vscode://file/Users/example/My%20Project/package.json')
    expect(vscodeUrl('/Users/example/My Project/package.json', 12)).toBe('vscode://file/Users/example/My%20Project/package.json:12')
    expect(vscodeUrl('C:\\work\\demo')).toBe('vscode://file/C%3A/work/demo')
  })

  it('allows only HTTP URLs from untrusted terminal output', () => {
    expect(externalHttpUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(() => externalHttpUrl('file:///tmp/script')).toThrow('Unsupported external URL protocol')
    expect(() => externalHttpUrl('javascript:alert(1)')).toThrow('Unsupported external URL protocol')
  })

  it('converts common Git remotes into credential-free repository URLs', () => {
    expect(gitRemoteHttpUrl('git@github.com:YunYouJun/craft-hub.git')).toBe('https://github.com/YunYouJun/craft-hub')
    expect(gitRemoteHttpUrl('ssh://git@gitlab.com/team/project.git')).toBe('https://gitlab.com/team/project')
    expect(gitRemoteHttpUrl('https://token@example.com/team/project.git')).toBe('https://example.com/team/project')
    expect(() => gitRemoteHttpUrl('file:///tmp/project')).toThrow('Unsupported Git remote URL protocol')
  })

  it('uses the installed macOS Codex launcher before PATH', () => {
    expect(codexCommand('darwin', path => path.includes('ChatGPT.app'))).toBe('/Applications/ChatGPT.app/Contents/Resources/codex')
    expect(codexCommand('linux', () => false)).toBe('codex')
  })

  it('constructs only safe Codex thread deep links', () => {
    expect(codexThreadUrl('123e4567-e89b-42d3-a456-426614174000')).toBe('codex://threads/123e4567-e89b-42d3-a456-426614174000')
    expect(() => codexThreadUrl('../new?prompt=unsafe')).toThrow('Invalid Codex thread id')
  })

  it('opens one Codex Desktop project with structured arguments and no shell', async () => {
    const child = new EventEmitter() as ChildProcess
    child.unref = vi.fn(() => child)
    const launch = vi.fn(() => child)
    const opened = openCodexProject('/project with spaces', launch)
    child.emit('spawn')
    await opened

    expect(launch).toHaveBeenCalledWith(expect.any(String), ['app', '/project with spaces'], {
      detached: true,
      shell: false,
      stdio: 'ignore',
    })
    expect(child.unref).toHaveBeenCalled()
  })

  it('activates Codex through macOS Launch Services', async () => {
    const child = new EventEmitter() as ChildProcess
    child.unref = vi.fn(() => child)
    const launch = vi.fn(() => child)
    const opened = focusCodexApplication('darwin', launch)
    child.emit('spawn')
    await opened

    expect(launch).toHaveBeenCalledWith('open', ['-b', 'com.openai.codex'], {
      detached: true,
      shell: false,
      stdio: 'ignore',
    })
  })

  it('opens Cursor with platform-specific structured arguments', async () => {
    const child = new EventEmitter() as ChildProcess
    child.unref = vi.fn(() => child)
    const launch = vi.fn(() => child)
    const opened = openCursorEditor('/project with spaces', 'darwin', launch)
    child.emit('spawn')
    await opened

    expect(launch).toHaveBeenCalledWith('open', ['-a', 'Cursor', '/project with spaces'], {
      detached: true,
      shell: false,
      stdio: 'ignore',
    })
  })

  it('launches a custom editor with path substitution and no shell', async () => {
    const child = new EventEmitter() as ChildProcess
    child.unref = vi.fn(() => child)
    const launch = vi.fn(() => child)
    const opened = openCustomEditor('/project with spaces', { name: 'Cursor', command: 'cursor', args: ['--reuse-window', '{path}'] }, launch)
    child.emit('spawn')
    await opened

    expect(launch).toHaveBeenCalledWith('cursor', ['--reuse-window', '/project with spaces'], {
      detached: true,
      shell: false,
      stdio: 'ignore',
    })
    await expect(openCustomEditor('/project', { name: 'Broken', command: 'editor', args: [] }, launch)).rejects.toThrow('{path}')
  })

  it('substitutes optional evidence line and column placeholders for custom editors', async () => {
    const child = new EventEmitter() as ChildProcess
    child.unref = vi.fn(() => child)
    const launch = vi.fn(() => child)
    const opened = openCustomEditor('/project/package.json', {
      name: 'Cursor',
      command: 'cursor',
      args: ['--goto', '{path}:{line}:{column}'],
    }, { line: 12, column: 3 }, launch)
    child.emit('spawn')
    await opened

    expect(launch).toHaveBeenCalledWith('cursor', ['--goto', '/project/package.json:12:3'], expect.objectContaining({ shell: false }))
  })

  it('prefers iTerm, then Ghostty, then Warp, and falls back to Terminal on macOS', () => {
    expect(macTerminalApplications('', path => path === '/Applications/Ghostty.app' || path.includes('/Terminal.app'))).toEqual(['Ghostty', 'Terminal'])
    expect(macTerminalApplication('', path => path === '/Applications/iTerm.app')).toBe('iTerm')
    expect(macTerminalApplication('', path => path === '/Applications/Ghostty.app')).toBe('Ghostty')
    expect(macTerminalApplication('', path => path === '/Applications/Warp.app')).toBe('Warp')
    expect(macTerminalApplication('', () => false)).toBe('Terminal')
    expect(macTerminalApplication('Ghostty', () => false)).toBe('Ghostty')
  })

  it('opens a project in the selected terminal with structured arguments and no shell', async () => {
    const child = new EventEmitter() as ChildProcess
    child.unref = vi.fn(() => child)
    const launch = vi.fn(() => child)
    const opened = openMacTerminalProject('/project with spaces', 'iTerm', 'darwin', launch)
    child.emit('spawn')
    await opened

    expect(launch).toHaveBeenCalledWith('open', ['-a', 'iTerm', '/project with spaces'], {
      detached: true,
      shell: false,
      stdio: 'ignore',
    })
    expect(child.unref).toHaveBeenCalled()
  })

  it('rejects terminal launch outside macOS', async () => {
    await expect(openMacTerminalProject('/project', 'Terminal', 'linux')).rejects.toThrow('supported on macOS only')
  })
})
