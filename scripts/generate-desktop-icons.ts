import { execFile } from 'node:child_process'
import { mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetsDirectory = resolve(repositoryRoot, 'apps/desktop/assets')
const iconComposerSource = join(assetsDirectory, 'icon.icon')
const ictool = process.env.ICTOOL
  ?? '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool'

// macOS icon grid: the rounded-rectangle body is 824 of 1024 points.
const bodyRatio = 824 / 1024
const iconsetSizes = [16, 32, 128, 256, 512] as const

async function renderIcon(outputFile: string, canvasSize: number): Promise<void> {
  const bodySize = Math.round(canvasSize * bodyRatio)
  await execFileAsync(ictool, [
    iconComposerSource,
    '--export-image',
    '--output-file',
    outputFile,
    '--platform',
    'macOS',
    '--rendition',
    'Default',
    '--width',
    String(bodySize),
    '--height',
    String(bodySize),
    '--scale',
    '1',
  ])
  await execFileAsync('sips', ['--padToHeightWidth', String(canvasSize), String(canvasSize), outputFile])
}

/**
 * Renders the Icon Composer source into the PNG used by the Electron window and
 * the `.icns` fallback for macOS releases before Liquid Glass.
 */
async function generateDesktopIcons(): Promise<void> {
  if (process.platform !== 'darwin')
    throw new Error('Desktop icons are rendered with Icon Composer and require macOS.')

  const workDirectory = await mkdtemp(join(tmpdir(), 'craft-hub-icons-'))
  try {
    const iconset = join(workDirectory, 'icon.iconset')
    await execFileAsync('mkdir', [iconset])
    for (const size of iconsetSizes) {
      await renderIcon(join(iconset, `icon_${size}x${size}.png`), size)
      await renderIcon(join(iconset, `icon_${size}x${size}@2x.png`), size * 2)
    }
    await execFileAsync('iconutil', ['--convert', 'icns', '--output', join(workDirectory, 'icon.icns'), iconset])
    await rename(join(workDirectory, 'icon.icns'), join(assetsDirectory, 'icon.icns'))
    await rename(join(iconset, 'icon_512x512@2x.png'), join(assetsDirectory, 'icon.png'))
  }
  finally {
    await rm(workDirectory, { force: true, recursive: true })
  }
  console.log('Generated apps/desktop/assets/icon.png and icon.icns from icon.icon')
}

await generateDesktopIcons()
