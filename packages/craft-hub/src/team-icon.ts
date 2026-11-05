import { Buffer } from 'node:buffer'
import { z } from 'zod'

/** Portable Team artwork: an HTTPS image or an embedded image up to 256 KiB. */
export const teamIconSchema = z.string().max(350_000).refine((value) => {
  const embedded = /^data:image\/(?:svg\+xml|png|webp|gif|jpeg|avif);base64,([A-Z0-9+/]+={0,2})$/i.exec(value)
  if (embedded)
    return embedded[1]!.length % 4 === 0 && Buffer.byteLength(embedded[1]!, 'base64') <= 256 * 1024
  if (value.length > 4096 || value !== value.trim())
    return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  }
  catch { return false }
}, 'Team logo must be an HTTPS image URL or an embedded image up to 256 KiB')
