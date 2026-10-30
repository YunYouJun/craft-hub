/// <reference lib="dom" />

/** Recognize a single neutral SVG ink without flattening colored artwork or contrasting details. */
export function isNeutralSvgImage(image: HTMLImageElement): boolean {
  // Package SVGs are resolved to inline images. Never read remote pixels or parse plugin markup into the page.
  if (!image.src.startsWith('data:image/svg+xml;base64,'))
    return false
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context)
      return false
    context.drawImage(image, 0, 0, 32, 32)
    const pixels = context.getImageData(0, 0, 32, 32).data
    let darkest = 255
    let lightest = 0
    let visible = false
    for (let index = 0; index < pixels.length; index += 4) {
      // Ignore mostly transparent edge pixels, whose unpremultiplied colors vary across renderers.
      if (pixels[index + 3]! < 128)
        continue
      const channels = [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!]
      const low = Math.min(...channels)
      const high = Math.max(...channels)
      if (high - low > 20)
        return false
      darkest = Math.min(darkest, low)
      lightest = Math.max(lightest, high)
      if (lightest - darkest > 24)
        return false
      visible = true
    }
    return visible
  }
  catch { return false }
}
