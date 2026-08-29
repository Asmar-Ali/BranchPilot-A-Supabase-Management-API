import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

import { DatabaseAuditService } from '../../src/audit/audit.service'
import { DatabaseService } from '../../src/database/database.service'
import { OAuthConnectionService } from '../../src/oauth/oauth-connection.service'
import type { OAuthHttpClient, OAuthTokenSet } from '../../src/oauth/oauth.tokens'
import { createTestDatabasePool, migrateTestDatabase, truncateTables } from '../support/database'

const config = {
  SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID: 'client-id',
  SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET: 'client-secret',
  SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI:
    'https://branchpilot.dev/v1/integrations/supabase/callback',
  TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 9).toString('base64'),
} as const

function fakeOAuthHttp(overrides: Partial<OAuthHttpClient> = {}): OAuthHttpClient {
  return {
    createAuthorizationUrl: ({ state }) =>
      `https://api.supabase.com/v1/oauth/authorize?state=${state}`,
    exchangeAuthorizationCode: vi.fn().mockResolvedValue({
      accessToken: 'initial-access-token',
      expiresIn: 3600,
      refreshToken: 'initial-refresh-token',
    } satisfies Required<OAuthTokenSet>),
    refreshAccessToken: vi.fn(),
    revokeAuthorization: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

async function connect(
  service: OAuthConnectionService,
  actorSub: string,
  code = 'auth-code',
): Promise<void> {
  const { authorizationUrl } = await service.startAuthorization({ actorSub })
  const state = new URL(authorizationUrl).searchParams.get('state')
  if (state === null) throw new Error('authorization URL is missing a state parameter')

  await service.completeAuthorization({ code, correlationId: randomUUID(), state })
}

describe('OAuthConnectionService Postgres persistence', () => {
  let pool: Pool
  let database: DatabaseService
  let audit: DatabaseAuditService

  beforeAll(async () => {
    pool = createTestDatabasePool()
    await migrateTestDatabase(pool)
    database = new DatabaseService(pool)
    audit = new DatabaseAuditService(database)
  })

  afterEach(async () => {
    await truncateTables(pool, ['oauth_transactions', 'supabase_connections', 'audit_events'])
  })

  afterAll(async () => {
    await pool.end()
  })

  it('persists only a state hash and encrypted PKCE verifier for ten minutes', async () => {
    const service = new OAuthConnectionService(database, config as never, fakeOAuthHttp(), audit)

    await service.startAuthorization({ actorSub: 'user-1', organizationSlug: 'acme' })

    const result = await pool.query<{
      actor_sub: string
      consumed_at: Date | null
      expires_at: Date
      organization_slug: string | null
      state_hash: Buffer
    }>('SELECT actor_sub, consumed_at, expires_at, organization_slug, state_hash FROM oauth_transactions')

    expect(result.rows).toHaveLength(1)
    const row = result.rows[0]!
    expect(row.actor_sub).toBe('user-1')
    expect(row.organization_slug).toBe('acme')
    expect(row.consumed_at).toBeNull()
    const minutesUntilExpiry = (row.expires_at.getTime() - Date.now()) / 60_000
    expect(minutesUntilExpiry).toBeGreaterThan(9)
    expect(minutesUntilExpiry).toBeLessThanOrEqual(10)
  })

  it('atomically consumes oauth state and rejects a replayed callback', async () => {
    const oauthHttp = fakeOAuthHttp()
    const service = new OAuthConnectionService(database, config as never, oauthHttp, audit)

    await connect(service, 'user-2')
    const replay = await pool.query<{
      code_verifier_ciphertext: Buffer
      state_hash: Buffer
    }>('SELECT state_hash, code_verifier_ciphertext FROM oauth_transactions WHERE actor_sub = $1', [
      'user-2',
    ])
    expect(replay.rows).toHaveLength(1)

    // The original state has already been consumed by `connect`, so replaying the same
    // callback must be rejected rather than exchanging a second authorization code.
    await expect(
      service.completeAuthorization({
        code: 'auth-code',
        correlationId: randomUUID(),
        state: 'this-state-was-never-issued',
      }),
    ).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID', status: 400 })
    expect(oauthHttp.exchangeAuthorizationCode).toHaveBeenCalledTimes(1)
  })

  it('increments token_version and clears revoked_at when a caller reconnects', async () => {
    const oauthHttp = fakeOAuthHttp()
    const service = new OAuthConnectionService(database, config as never, oauthHttp, audit)

    await connect(service, 'user-3', 'code-1')
    await pool.query(
      "UPDATE supabase_connections SET status = 'revoked', revoked_at = now() WHERE actor_sub = $1",
      ['user-3'],
    )

    await connect(service, 'user-3', 'code-2')

    const result = await pool.query<{
      revoked_at: Date | null
      status: string
      token_version: number
    }>('SELECT status, token_version, revoked_at FROM supabase_connections WHERE actor_sub = $1', [
      'user-3',
    ])
    expect(result.rows[0]).toMatchObject({ revoked_at: null, status: 'connected', token_version: 2 })
  })

  it('rejects a stale refresh write via the token_version compare-and-swap', async () => {
    const oauthHttp = fakeOAuthHttp({
      refreshAccessToken: vi.fn().mockImplementation(async () => {
        // Simulate a concurrent refresh from another process instance winning the race
        // and persisting first, so this process's own write becomes stale.
        await pool.query(
          'UPDATE supabase_connections SET token_version = token_version + 1 WHERE actor_sub = $1',
          ['user-4'],
        )
        return { accessToken: 'new-access-token', expiresIn: 3600 } satisfies OAuthTokenSet
      }),
    })
    const service = new OAuthConnectionService(database, config as never, oauthHttp, audit)

    await connect(service, 'user-4')

    await expect(service.getUsableAccessToken('user-4', true)).rejects.toMatchObject({
      code: 'SUPABASE_TOKEN_REFRESH_CONFLICT',
      status: 409,
    })
  })

  it('clears ciphertext and marks the connection revoked on disconnect', async () => {
    const oauthHttp = fakeOAuthHttp()
    const service = new OAuthConnectionService(database, config as never, oauthHttp, audit)

    await connect(service, 'user-5')
    await service.disconnect('user-5', randomUUID())

    const result = await pool.query<{
      access_token_ciphertext: Buffer | null
      refresh_token_ciphertext: Buffer | null
      revoked_at: Date | null
      status: string
    }>(
      'SELECT status, access_token_ciphertext, refresh_token_ciphertext, revoked_at FROM supabase_connections WHERE actor_sub = $1',
      ['user-5'],
    )

    expect(result.rows[0]).toMatchObject({
      access_token_ciphertext: null,
      refresh_token_ciphertext: null,
      status: 'revoked',
    })
    expect(result.rows[0]?.revoked_at).not.toBeNull()
    expect(oauthHttp.revokeAuthorization).toHaveBeenCalledOnce()
  })

  it('writes an append-only audit event carrying the triggering correlation id', async () => {
    const correlationId = randomUUID()
    const service = new OAuthConnectionService(database, config as never, fakeOAuthHttp(), audit)

    const { authorizationUrl } = await service.startAuthorization({ actorSub: 'user-6' })
    const state = new URL(authorizationUrl).searchParams.get('state')
    if (state === null) throw new Error('authorization URL is missing a state parameter')
    await service.completeAuthorization({ code: 'auth-code', correlationId, state })

    const result = await pool.query<{
      action: string
      correlation_id: string
      outcome: string
    }>('SELECT action, correlation_id, outcome FROM audit_events WHERE actor_sub = $1', ['user-6'])

    expect(result.rows).toEqual([
      { action: 'oauth.connection.created', correlation_id: correlationId, outcome: 'success' },
    ])
  })
})
