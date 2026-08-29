import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Pool } from 'pg'
import request from 'supertest'

import { AppModule } from '../../src/app.module'
import { configureHttpApplication } from '../../src/common/http/configure-http-application'
import { APP_CONFIG } from '../../src/config/config.module'
import type { Environment } from '../../src/config/env.schema'
import { OAUTH_HTTP_CLIENT, type OAuthHttpClient, type OAuthTokenSet } from '../../src/oauth/oauth.tokens'
import { createTestDatabasePool, migrateTestDatabase, truncateTables } from '../support/database'

const keyId = 'branchpilot-test-key'

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function signedUserToken(privateKey: KeyObject, actorSub: string): string {
  const header = base64UrlJson({ alg: 'RS256', kid: keyId, typ: 'JWT' })
  const payload = base64UrlJson({
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    iat: Math.floor(Date.now() / 1000),
    role: 'authenticated',
    sub: actorSub,
  })
  const signingInput = `${header}.${payload}`
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .end()
    .sign(privateKey, 'base64url')

  return `${signingInput}.${signature}`
}

function fakeOAuthHttp(): OAuthHttpClient {
  return {
    createAuthorizationUrl: ({ state }) =>
      `https://api.supabase.com/v1/oauth/authorize?state=${state}`,
    exchangeAuthorizationCode: vi.fn().mockResolvedValue({
      accessToken: 'e2e-access-token',
      expiresIn: 3600,
      refreshToken: 'e2e-refresh-token',
    } satisfies Required<OAuthTokenSet>),
    refreshAccessToken: vi.fn(),
    revokeAuthorization: vi.fn().mockResolvedValue(undefined),
  }
}

describe('Supabase OAuth connection lifecycle', () => {
  let app: INestApplication
  let pool: Pool
  let privateKey: KeyObject
  let oauthHttp: OAuthHttpClient

  beforeAll(async () => {
    const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const publicJwk = keyPair.publicKey.export({ format: 'jwk' })

    Object.assign(publicJwk, { alg: 'RS256', kid: keyId, use: 'sig' })
    process.env.SUPABASE_JWKS = JSON.stringify({ keys: [publicJwk] })
    privateKey = keyPair.privateKey

    pool = createTestDatabasePool()
    await migrateTestDatabase(pool)

    oauthHttp = fakeOAuthHttp()
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OAUTH_HTTP_CLIENT)
      .useValue(oauthHttp)
      .compile()

    app = moduleRef.createNestApplication()
    configureHttpApplication(app, app.get<Environment>(APP_CONFIG))
    await app.init()
  })

  afterEach(async () => {
    await truncateTables(pool, ['oauth_transactions', 'supabase_connections', 'audit_events'])
    vi.clearAllMocks()
  })

  afterAll(async () => {
    delete process.env.SUPABASE_JWKS

    if (app !== undefined) {
      await app.close()
    }
    await pool.end()
  })

  async function startAuthorization(actorSub: string): Promise<string> {
    const token = signedUserToken(privateKey, actorSub)
    const response = await request(app.getHttpServer())
      .post('/v1/integrations/supabase/authorize')
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
    const url = new URL(response.body.authorizationUrl as string)
    const state = url.searchParams.get('state')
    if (state === null) throw new Error('authorization URL is missing a state parameter')
    return state
  }

  describe('authorize', () => {
    it('rejects requests without a bearer token', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/integrations/supabase/authorize')
        .expect('Content-Type', /application\/problem\+json/)
        .expect(401)

      expect(response.body).toMatchObject({ code: 'UNAUTHORIZED', status: 401 })
    })

    it('rejects an invalid organization_slug', async () => {
      const token = signedUserToken(privateKey, 'user-1')

      const response = await request(app.getHttpServer())
        .post('/v1/integrations/supabase/authorize?organization_slug=Not%20Valid!')
        .set('Authorization', `Bearer ${token}`)
        .expect('Content-Type', /application\/problem\+json/)
        .expect(400)

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    })

    it('returns an authorization URL and persists the oauth state', async () => {
      await startAuthorization('user-2')

      const rows = await pool.query('SELECT actor_sub FROM oauth_transactions')
      expect(rows.rows).toEqual([{ actor_sub: 'user-2' }])
    })
  })

  describe('callback', () => {
    it('is public and connects the caller for a valid code and state', async () => {
      const state = await startAuthorization('user-3')

      const response = await request(app.getHttpServer())
        .get('/v1/integrations/supabase/callback')
        .query({ code: 'auth-code', state })
        .expect(200)

      expect(response.body).toEqual({ status: 'connected' })
      const rows = await pool.query<{ status: string }>(
        'SELECT status FROM supabase_connections WHERE actor_sub = $1',
        ['user-3'],
      )
      expect(rows.rows).toEqual([{ status: 'connected' }])
    })

    it('rejects a request missing code or state', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/integrations/supabase/callback')
        .query({ state: 'only-state' })
        .expect('Content-Type', /application\/problem\+json/)
        .expect(400)

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    })

    it('rejects a replayed callback state', async () => {
      const state = await startAuthorization('user-4')

      await request(app.getHttpServer())
        .get('/v1/integrations/supabase/callback')
        .query({ code: 'auth-code', state })
        .expect(200)

      const response = await request(app.getHttpServer())
        .get('/v1/integrations/supabase/callback')
        .query({ code: 'auth-code', state })
        .expect('Content-Type', /application\/problem\+json/)
        .expect(400)

      expect(response.body).toMatchObject({ code: 'OAUTH_STATE_INVALID', status: 400 })
    })
  })

  describe('disconnect', () => {
    it('rejects requests without a bearer token', async () => {
      await request(app.getHttpServer())
        .delete('/v1/integrations/supabase')
        .expect('Content-Type', /application\/problem\+json/)
        .expect(401)
    })

    it('revokes a connected caller and clears their stored tokens', async () => {
      const state = await startAuthorization('user-5')
      await request(app.getHttpServer())
        .get('/v1/integrations/supabase/callback')
        .query({ code: 'auth-code', state })
        .expect(200)
      const token = signedUserToken(privateKey, 'user-5')

      await request(app.getHttpServer())
        .delete('/v1/integrations/supabase')
        .set('Authorization', `Bearer ${token}`)
        .expect(204)

      expect(vi.mocked(oauthHttp.revokeAuthorization)).toHaveBeenCalledOnce()
      const rows = await pool.query<{ access_token_ciphertext: Buffer | null; status: string }>(
        'SELECT status, access_token_ciphertext FROM supabase_connections WHERE actor_sub = $1',
        ['user-5'],
      )
      expect(rows.rows).toEqual([{ access_token_ciphertext: null, status: 'revoked' }])
    })
  })

  it('keeps health liveness public throughout the lifecycle', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({ status: 'ok' })
  })
})
