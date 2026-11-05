/// <reference lib="dom" />

function luminance(red: number, green: number, blue: number): number {
  const channels = [red, green, blue].map((value) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
}

function contrast(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** Choose a neutral backplate for loaded transparent artwork without changing its colors or fetching it again. */
export function logoBackdrop(image: HTMLImageElement): 'light' | 'dark' {
  try {
    const source = new URL(image.currentSrc || image.src, document.baseURI)
    // Avoid tainting the canvas or issuing another request for ordinary cross-origin images.
    if (source.protocol !== 'data:' && source.origin !== document.location.origin && !image.crossOrigin)
      return 'light'
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context)
      return 'light'
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    let weight = 0
    let lightness = 0
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3]! / 255
      weight += alpha
      lightness += luminance(data[index]!, data[index + 1]!, data[index + 2]!) * alpha
    }
    // Opaque artwork already owns its background; retain a light rim around its original shape.
    if (!weight || weight / (canvas.width * canvas.height) > 0.98)
      return 'light'
    const average = lightness / weight
    return contrast(average, luminance(58, 58, 60)) > contrast(average, 1) ? 'dark' : 'light'
  }
  catch {
    // Cross-origin images remain visible even when the browser cannot expose their pixels.
    return 'light'
  }
}
