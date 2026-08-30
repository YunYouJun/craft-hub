import packageJson from '../package.json' with { type: 'json' }

/** Version of the running Craft Hub package. */
export const craftHubVersion = packageJson.version
