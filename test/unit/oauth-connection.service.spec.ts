import { Buffer } from 'node:buffer'
import type { QueryResult, QueryResultRow } from 'pg'

import type { AuditEvent, AuditService } from '../../src/audit/audit.tokens'
import type { AppError } from '../../src/common/errors/app-error'
import type { Database } from '../../src/database/database.service'
import { OAuthConnectionService } from '../../src/oauth/oauth-connection.service'
import type { OAuthHttpClient } from '../../src/oauth/oauth.tokens'
import { OAuthHttpError } from '../../src/oauth/supabase-oauth-http.client'
import { TokenCipher } from '../../src/oauth/token-cipher'

function queryResult<Row extends QueryResultRow>(
  rows: Row[],
  rowCount = rows.length,
): QueryResult<Row> {
  return { rowCount, rows } as unknown as QueryResult<Row>
}

function fakeAudit(): AuditService & { readonly events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    events,
    record: vi.fn(async (event: AuditEvent) => {
      events.push(event)
    }),
  }
}

const config = {
  SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID: 'client-id',
  SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET: 'client-secret',
  SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI:
    'https://branchpilot.dev/v1/integrations/supabase/callback',
  TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 3).toString('base64'),
} as const

describe('OAuthConnectionService', () => {
  it('persists only a state hash and encrypted PKCE verifier', async () => {
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockResolvedValue(queryResult([])),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: ({ challenge, organizationSlug, state }) => {
        const url = new URL('https://api.supabase.com/v1/oauth/authorize')
        url.search = new URLSearchParams({
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        }).toString()
        if (organizationSlug !== undefined)
          url.searchParams.set('organization_slug', organizationSlug)
        return url.toString()
      },
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeAuthorization: vi.fn(),
    }
    const service = new OAuthConnectionService(database, config as never, oauthHttp, fakeAudit())

    const result = await service.startAuthorization({
      actorSub: 'user-1',
      organizationSlug: 'acme',
    })
    const url = new URL(result.authorizationUrl)
    const query = vi.mocked(database.query).mock.calls[0]?.[0]

    expect(url.origin).toBe('https://api.supabase.com')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('organization_slug')).toBe('acme')
    expect(query?.values?.[0]).toBeInstanceOf(Buffer)
    expect(query?.values?.[2]).toBeInstanceOf(Buffer)
    expect((query?.values?.[2] as Buffer).toString('utf8')).not.toContain(
      url.searchParams.get('code_challenge') ?? '',
    )
  })

  it('rejects expired or replayed state before exchanging a code, and writes a security audit event', async () => {
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockResolvedValue(queryResult([])),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeAuthorization: vi.fn(),
    }
    const audit = fakeAudit()
    const service = new OAuthConnectionService(database, config as never, oauthHttp, audit)
    const correlationId = crypto.randomUUID()

    await expect(
      service.completeAuthorization({
        code: 'code',
        correlationId,
        state: 'expired',
      }),
    ).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
      status: 400,
    } satisfies Partial<AppError>)
    expect(oauthHttp.exchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(audit.events).toEqual([
      {
        actorSub: 'unknown',
        action: 'oauth.state.invalid',
        correlationId,
        outcome: 'failure',
        targetType: 'oauth_state',
      },
    ])
  })

  it('marks an invalid-grant refresh as revoked and requires reauthorization', async () => {
    const refreshTokenCiphertext = new TokenCipher(config.TOKEN_ENCRYPTION_KEY_BASE64).encrypt(
      'refresh-token',
    )
    const database = {
      ping: vi.fn(),
      query: vi
        .fn()
        .mockResolvedValueOnce(
          queryResult([
            {
              access_token_ciphertext: null,
              access_token_expires_at: new Date(0),
              actor_sub: 'user-1',
              refresh_token_ciphertext: refreshTokenCiphertext,
              status: 'connected',
              token_version: 1,
            },
          ]),
        )
        .mockResolvedValueOnce(queryResult([])),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn().mockRejectedValue(new OAuthHttpError('invalid_grant', 400)),
      revokeAuthorization: vi.fn(),
    }
    const service = new OAuthConnectionService(database, config as never, oauthHttp, fakeAudit())

    await expect(service.getUsableAccessToken('user-1')).rejects.toMatchObject({
      code: 'SUPABASE_REAUTH_REQUIRED',
      status: 409,
    } satisfies Partial<AppError>)
  })

  it('returns a cached access token without refreshing when it is not near expiry', async () => {
    const cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY_BASE64)
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockResolvedValue(
        queryResult([
          {
            access_token_ciphertext: cipher.encrypt('cached-access-token'),
            access_token_expires_at: new Date(Date.now() + 10 * 60_000),
            actor_sub: 'user-1',
            refresh_token_ciphertext: cipher.encrypt('refresh-token'),
            status: 'connected',
            token_version: 1,
          },
        ]),
      ),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeAuthorization: vi.fn(),
    }
    const service = new OAuthConnectionService(database, config as never, oauthHttp, fakeAudit())

    await expect(service.getUsableAccessToken('user-1')).resolves.toBe('cached-access-token')
    expect(oauthHttp.refreshAccessToken).not.toHaveBeenCalled()
  })

  it('requires reauthorization when no connection exists for the caller', async () => {
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockResolvedValue(queryResult([])),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeAuthorization: vi.fn(),
    }
    const service = new OAuthConnectionService(database, config as never, oauthHttp, fakeAudit())

    await expect(service.getUsableAccessToken('user-1')).rejects.toMatchObject({
      code: 'SUPABASE_REAUTH_REQUIRED',
      status: 409,
    } satisfies Partial<AppError>)
  })

  it('requires reauthorization when the connection status is not connected', async () => {
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockResolvedValue(
        queryResult([
          {
            access_token_ciphertext: null,
            access_token_expires_at: null,
            actor_sub: 'user-1',
            refresh_token_ciphertext: null,
            status: 'revoked',
            token_version: 1,
          },
        ]),
      ),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeAuthorization: vi.fn(),
    }
    const service = new OAuthConnectionService(database, config as never, oauthHttp, fakeAudit())

    await expect(service.getUsableAccessToken('user-1')).rejects.toMatchObject({
      code: 'SUPABASE_REAUTH_REQUIRED',
      status: 409,
    } satisfies Partial<AppError>)
  })

  it('coalesces concurrent forced refreshes for the same caller into one upstream call', async () => {
    const cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY_BASE64)
    const connectionRow = {
      access_token_ciphertext: null,
      access_token_expires_at: new Date(0),
      actor_sub: 'user-1',
      refresh_token_ciphertext: cipher.encrypt('refresh-token'),
      status: 'connected',
      token_version: 1,
    }
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockImplementation(({ text }: { text: string }) =>
        Promise.resolve(
          text.includes('UPDATE supabase_connections')
            ? queryResult([], 1)
            : queryResult([connectionRow]),
        ),
      ),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi
        .fn()
        .mockResolvedValue({ accessToken: 'refreshed-token', expiresIn: 3600 }),
      revokeAuthorization: vi.fn(),
    }
    const service = new OAuthConnectionService(database, config as never, oauthHttp, fakeAudit())

    const [first, second] = await Promise.all([
      service.getUsableAccessToken('user-1', true),
      service.getUsableAccessToken('user-1', true),
    ])

    expect(first).toBe('refreshed-token')
    expect(second).toBe('refreshed-token')
    expect(oauthHttp.refreshAccessToken).toHaveBeenCalledOnce()
  })

  it('treats a zero row-count refresh update as a version conflict', async () => {
    const cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY_BASE64)
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockImplementation(({ text }: { text: string }) =>
        Promise.resolve(
          text.includes('UPDATE supabase_connections')
            ? queryResult([], 0)
            : queryResult([
                {
                  access_token_ciphertext: null,
                  access_token_expires_at: new Date(0),
                  actor_sub: 'user-1',
                  refresh_token_ciphertext: cipher.encrypt('refresh-token'),
                  status: 'connected',
                  token_version: 1,
                },
              ]),
        ),
      ),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn().mockResolvedValue({ accessToken: 'new-token', expiresIn: 3600 }),
      revokeAuthorization: vi.fn(),
    }
    const service = new OAuthConnectionService(database, config as never, oauthHttp, fakeAudit())

    await expect(service.getUsableAccessToken('user-1', true)).rejects.toMatchObject({
      code: 'SUPABASE_TOKEN_REFRESH_CONFLICT',
      status: 409,
    } satisfies Partial<AppError>)
  })

  it('surfaces a transient upstream refresh failure as retryable', async () => {
    const cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY_BASE64)
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockResolvedValue(
        queryResult([
          {
            access_token_ciphertext: null,
            access_token_expires_at: new Date(0),
            actor_sub: 'user-1',
            refresh_token_ciphertext: cipher.encrypt('refresh-token'),
            status: 'connected',
            token_version: 1,
          },
        ]),
      ),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn().mockRejectedValue(new OAuthHttpError('server_error', 503)),
      revokeAuthorization: vi.fn(),
    }
    const service = new OAuthConnectionService(database, config as never, oauthHttp, fakeAudit())

    await expect(service.getUsableAccessToken('user-1', true)).rejects.toMatchObject({
      code: 'SUPABASE_TOKEN_REFRESH_FAILED',
      retryable: true,
      status: 503,
    } satisfies Partial<AppError>)
  })

  it('replaces the stored refresh token when the upstream response rotates it', async () => {
    const cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY_BASE64)
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockResolvedValue(
        queryResult([
          {
            access_token_ciphertext: null,
            access_token_expires_at: new Date(0),
            actor_sub: 'user-1',
            refresh_token_ciphertext: cipher.encrypt('old-refresh-token'),
            status: 'connected',
            token_version: 1,
          },
        ]),
      ),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn().mockResolvedValue({
        accessToken: 'new-access-token',
        expiresIn: 3600,
        refreshToken: 'rotated-refresh-token',
      }),
      revokeAuthorization: vi.fn(),
    }
    const service = new OAuthConnectionService(database, config as never, oauthHttp, fakeAudit())

    await service.getUsableAccessToken('user-1', true)

    const updateCall = vi
      .mocked(database.query)
      .mock.calls.find(([query]) => query.text.includes('UPDATE supabase_connections'))
    const storedRefreshToken = updateCall?.[0].values?.[1] as Buffer
    expect(cipher.decrypt(storedRefreshToken)).toBe('rotated-refresh-token')
  })

  it('retains the existing refresh token when the upstream response omits one', async () => {
    const cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY_BASE64)
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockResolvedValue(
        queryResult([
          {
            access_token_ciphertext: null,
            access_token_expires_at: new Date(0),
            actor_sub: 'user-1',
            refresh_token_ciphertext: cipher.encrypt('stable-refresh-token'),
            status: 'connected',
            token_version: 1,
          },
        ]),
      ),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi
        .fn()
        .mockResolvedValue({ accessToken: 'new-access-token', expiresIn: 3600 }),
      revokeAuthorization: vi.fn(),
    }
    const service = new OAuthConnectionService(database, config as never, oauthHttp, fakeAudit())

    await service.getUsableAccessToken('user-1', true)

    const updateCall = vi
      .mocked(database.query)
      .mock.calls.find(([query]) => query.text.includes('UPDATE supabase_connections'))
    const storedRefreshToken = updateCall?.[0].values?.[1] as Buffer
    expect(cipher.decrypt(storedRefreshToken)).toBe('stable-refresh-token')
  })

  it('saves connected tokens and writes an audit event on a successful callback', async () => {
    const cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY_BASE64)
    const database = {
      ping: vi.fn(),
      query: vi
        .fn()
        .mockResolvedValue(
          queryResult([{ actor_sub: 'user-1', code_verifier_ciphertext: cipher.encrypt('verifier') }]),
        ),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        accessToken: 'access-token',
        expiresIn: 3600,
        refreshToken: 'refresh-token',
      }),
      refreshAccessToken: vi.fn(),
      revokeAuthorization: vi.fn(),
    }
    const audit = fakeAudit()
    const service = new OAuthConnectionService(database, config as never, oauthHttp, audit)

    await service.completeAuthorization({ code: 'auth-code', correlationId: 'corr-1', state: 'state' })

    expect(oauthHttp.exchangeAuthorizationCode).toHaveBeenCalledWith({
      code: 'auth-code',
      codeVerifier: 'verifier',
    })
    const insertCall = vi
      .mocked(database.query)
      .mock.calls.find(([query]) => query.text.includes('INSERT INTO supabase_connections'))
    expect(insertCall).toBeDefined()
    expect(audit.events).toEqual([
      {
        actorSub: 'user-1',
        action: 'oauth.connection.created',
        correlationId: 'corr-1',
        outcome: 'success',
        targetType: 'supabase_connection',
      },
    ])
  })

  it('does nothing when disconnecting a caller with no stored refresh token', async () => {
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockResolvedValue(
        queryResult([
          {
            access_token_ciphertext: null,
            access_token_expires_at: null,
            actor_sub: 'user-1',
            refresh_token_ciphertext: null,
            status: 'connected',
            token_version: 1,
          },
        ]),
      ),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeAuthorization: vi.fn(),
    }
    const service = new OAuthConnectionService(database, config as never, oauthHttp, fakeAudit())

    await service.disconnect('user-1', 'corr-1')

    expect(oauthHttp.revokeAuthorization).not.toHaveBeenCalled()
    expect(vi.mocked(database.query)).toHaveBeenCalledTimes(1)
  })

  it('does nothing when disconnecting an already-revoked connection', async () => {
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockResolvedValue(
        queryResult([
          {
            access_token_ciphertext: null,
            access_token_expires_at: null,
            actor_sub: 'user-1',
            refresh_token_ciphertext: Buffer.from('irrelevant'),
            status: 'revoked',
            token_version: 1,
          },
        ]),
      ),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeAuthorization: vi.fn(),
    }
    const service = new OAuthConnectionService(database, config as never, oauthHttp, fakeAudit())

    await service.disconnect('user-1', 'corr-1')

    expect(oauthHttp.revokeAuthorization).not.toHaveBeenCalled()
  })

  it('revokes upstream access and clears ciphertext on successful disconnect', async () => {
    const cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY_BASE64)
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockResolvedValue(
        queryResult([
          {
            access_token_ciphertext: cipher.encrypt('access-token'),
            access_token_expires_at: new Date(),
            actor_sub: 'user-1',
            refresh_token_ciphertext: cipher.encrypt('refresh-token'),
            status: 'connected',
            token_version: 1,
          },
        ]),
      ),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeAuthorization: vi.fn().mockResolvedValue(undefined),
    }
    const audit = fakeAudit()
    const service = new OAuthConnectionService(database, config as never, oauthHttp, audit)

    await service.disconnect('user-1', 'corr-1')

    expect(oauthHttp.revokeAuthorization).toHaveBeenCalledWith('refresh-token')
    const revokeUpdate = vi
      .mocked(database.query)
      .mock.calls.find(([query]) => query.text.includes("status = 'revoked'"))
    expect(revokeUpdate).toBeDefined()
    expect(audit.events).toEqual([
      {
        actorSub: 'user-1',
        action: 'oauth.connection.revoked',
        correlationId: 'corr-1',
        outcome: 'success',
        targetType: 'supabase_connection',
      },
    ])
  })

  it('marks revocation_pending and returns non-retryable on a permanent upstream revocation failure', async () => {
    const cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY_BASE64)
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockResolvedValue(
        queryResult([
          {
            access_token_ciphertext: null,
            access_token_expires_at: null,
            actor_sub: 'user-1',
            refresh_token_ciphertext: cipher.encrypt('refresh-token'),
            status: 'connected',
            token_version: 1,
          },
        ]),
      ),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeAuthorization: vi.fn().mockRejectedValue(new OAuthHttpError('invalid_grant', 400)),
    }
    const audit = fakeAudit()
    const service = new OAuthConnectionService(database, config as never, oauthHttp, audit)

    await expect(service.disconnect('user-1', 'corr-1')).rejects.toMatchObject({
      code: 'SUPABASE_REVOCATION_FAILED',
      retryable: false,
      status: 502,
    } satisfies Partial<AppError>)

    const pendingUpdate = vi
      .mocked(database.query)
      .mock.calls.find(([query]) => query.text.includes('revocation_pending'))
    expect(pendingUpdate).toBeDefined()
    expect(audit.events).toEqual([
      {
        actorSub: 'user-1',
        action: 'oauth.connection.revocation_failed',
        correlationId: 'corr-1',
        outcome: 'failure',
        targetType: 'supabase_connection',
        upstreamStatus: 400,
      },
    ])
  })

  it('marks revocation_pending and returns retryable on a transient upstream revocation failure', async () => {
    const cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY_BASE64)
    const database = {
      ping: vi.fn(),
      query: vi.fn().mockResolvedValue(
        queryResult([
          {
            access_token_ciphertext: null,
            access_token_expires_at: null,
            actor_sub: 'user-1',
            refresh_token_ciphertext: cipher.encrypt('refresh-token'),
            status: 'connected',
            token_version: 1,
          },
        ]),
      ),
    } as unknown as Database
    const oauthHttp: OAuthHttpClient = {
      createAuthorizationUrl: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeAuthorization: vi.fn().mockRejectedValue(new TypeError('network error')),
    }
    const audit = fakeAudit()
    const service = new OAuthConnectionService(database, config as never, oauthHttp, audit)

    await expect(service.disconnect('user-1', 'corr-1')).rejects.toMatchObject({
      code: 'SUPABASE_REVOCATION_PENDING',
      retryable: true,
      status: 503,
    } satisfies Partial<AppError>)
    expect(audit.events).toEqual([
      {
        actorSub: 'user-1',
        action: 'oauth.connection.revocation_pending',
        correlationId: 'corr-1',
        outcome: 'failure',
        targetType: 'supabase_connection',
      },
    ])
  })
})
