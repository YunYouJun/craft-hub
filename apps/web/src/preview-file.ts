import type { FileContents } from '@pierre/diffs'

/** Describe preview text without changing its content or treating its path as a URL. */
export function previewFile(content: string, path = 'preview.txt'): FileContents {
  // Configuration reviews can serialize a TOML fragment as redacted JSON.
  try {
    JSON.parse(content)
    return { name: path, contents: content, lang: 'json' }
  }
  catch {
    return { name: path, contents: content }
  }
}
