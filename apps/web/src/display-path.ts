const POSIX_HOME_PREFIX = /^\/(?:Users|home)\/[^/]+(?=\/|$)/
const WINDOWS_USER_PREFIX = /^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/

/**
 * Abbreviates a user home directory prefix to `~` for display in workbench chrome
 * while leaving project-relative, `/workspace`, or system paths unchanged.
 */
export function formatDisplayPath(value: string | undefined): string {
  if (!value)
    return ''
  if (POSIX_HOME_PREFIX.test(value))
    return value.replace(POSIX_HOME_PREFIX, '~')
  if (WINDOWS_USER_PREFIX.test(value))
    return value.replace(WINDOWS_USER_PREFIX, '~')
  return value
}
