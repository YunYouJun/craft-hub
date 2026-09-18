import { readFileSync } from 'node:fs'

// Reuse the workbench artwork and keep the portable Devframe icon self-contained.
export const inspectorLogo = `data:image/svg+xml;base64,${readFileSync(new URL('../public/favicon.svg', import.meta.url)).toString('base64')}`
