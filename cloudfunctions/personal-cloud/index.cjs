const process = require('node:process')
const tcb = require('@cloudbase/node-sdk')
const { deriveSessionCsrfToken, ServerSessionService, verifySessionCsrfToken } = require('@yunlefun/server-session')
const { CloudBaseSessionStore } = require('@yunlefun/server-session-cloudbase')
const { verifySsoIdentityProof } = require('@yunlefun/sso/server')
const { CloudBasePersonalCloudRepository } = require('./cloudbase-repository.cjs')
const { createPersonalCloudServer } = require('./core.cjs')

const envId = requiredEnv('CLOUDBASE_ENV_ID')
const appId = requiredEnv('YUNLEFUN_SSO_APP_ID')
const sessionSecret = requiredEnv('CRAFT_HUB_SESSION_SECRET')
const application = tcb.init({ env: envId, accessKey: requiredEnv('CLOUDBASE_APIKEY') })
const database = application.database()
const sessionService = new ServerSessionService({
  store: new CloudBaseSessionStore({ database }),
  policy: {
    idleTtlMs: 7 * 24 * 60 * 60 * 1000,
    absoluteTtlMs: 30 * 24 * 60 * 60 * 1000,
    touchIntervalMs: 5 * 60 * 1000,
    rotationIntervalMs: 24 * 60 * 60 * 1000,
    maxSessions: 4,
  },
})

const server = createPersonalCloudServer({
  appId,
  allowedSubjects: new Set(requiredEnv('YUNLEFUN_ALLOWED_SUBJECTS').split(',').map(value => value.trim()).filter(Boolean)),
  deriveCsrf: token => deriveSessionCsrfToken(token, sessionSecret, appId),
  verifyCsrf: (csrf, token) => verifySessionCsrfToken(csrf, token, sessionSecret, appId),
  verifyIdentity: proof => verifySsoIdentityProof(proof, {
    cloudbaseEnvId: envId,
    appId,
    clientId: requiredEnv('YUNLEFUN_SSO_CLIENT_ID'),
    issuer: requiredEnv('YUNLEFUN_SSO_ISSUER'),
    jwksUrl: requiredEnv('YUNLEFUN_SSO_JWKS_URL'),
  }),
  repository: new CloudBasePersonalCloudRepository(database),
  sessionService,
  origin: requiredEnv('CRAFT_HUB_CLOUD_ORIGIN'),
  now: () => Date.now(),
})

server.listen(9000)

function requiredEnv(name) {
  const value = process.env[name]
  if (!value)
    throw new Error(`Missing required environment variable: ${name}`)
  return value
}
