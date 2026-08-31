/**
 * Convert the workspace SemVer into the three-part numeric version required by
 * macOS and compared by Squirrel.Mac. Stable releases sort after all numeric
 * alpha releases for the same SemVer core.
 */
export function macosApplicationVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+))?$/.exec(version)
  if (!match)
    throw new Error(`Desktop version must be a stable or numeric alpha SemVer: ${version}`)

  const patch = Number(match[3])
  const alpha = match[4] === undefined ? 999 : Number(match[4])
  if (!Number.isSafeInteger(patch) || !Number.isSafeInteger(alpha) || alpha < 0 || (match[4] !== undefined && alpha > 998))
    throw new Error(`Desktop version is outside the supported macOS update range: ${version}`)

  return `${match[1]}.${match[2]}.${patch * 1000 + alpha}`
}
