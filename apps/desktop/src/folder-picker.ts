export interface DirectoryDialogResult {
  canceled: boolean
  filePaths: string[]
}

/** Return the first selected directory, or undefined when the picker was cancelled. */
export function selectedDirectoryPath(result: DirectoryDialogResult): string | undefined {
  if (result.canceled)
    return undefined
  return result.filePaths[0]
}

/** Return every unique selected directory, or undefined when the picker was cancelled. */
export function selectedDirectoryPaths(result: DirectoryDialogResult): string[] | undefined {
  if (result.canceled)
    return undefined
  return [...new Set(result.filePaths)]
}
