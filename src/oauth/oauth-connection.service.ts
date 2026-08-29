import { Inject, Injectable } from '@nestjs/common'
import type { QueryResultRow } from 'pg'

import { AUDIT_SERVICE, type AuditService } from '../audit/audit.tokens'
import { AppError } from '../common/errors/app-error'
import { DATABASE } from '../database/database.tokens'
import type { Database } from '../database/database.service'
import { APP_CONFIG } from '../config/config.module'
import type { Environment } from '../config/env.schema'
import { withSpan } from '../observability/tracer'
import { createOAuthState, createPkcePair, hashOAuthState } from './pkce'
import { OAUTH_HTTP_CLIENT, type OAuthHttpClient, type OAuthTokenSet } from './oauth.tokens'
import { OAuthHttpError } from './supabase-oauth-http.client'
import { TokenCipher } from './token-cipher'

interface OAuthTransactionRow extends QueryResultRow {
  readonly actor_sub: string
  readonly code_verifier_ciphertext: Buffer
}

interface ConnectionRow extends QueryResultRow {
  readonly access_token_ciphertext: Buffer | null
  readonly access_token_expires_at: Date | null
  readonly actor_sub: string
  readonly refresh_token_ciphertext: Buffer | null
  readonly status: string
  readonly token_version: number
}

const problem = (name: string): string => `https://branchpilot.dev/problems/${name}`

@Injectable()
export class OAuthConnectionService {
  private readonly cipher: TokenCipher
  private readonly refreshes = new Map<string, Promise<string>>()

  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: Environment,
    @Inject(OAUTH_HTTP_CLIENT) private readonly oauthHttp: OAuthHttpClient,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {
    this.cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY_BASE64)
  }

  public async startAuthorization(input: {
    readonly actorSub: string
    readonly organizationSlug?: string
  }): Promise<{ authorizationUrl: string }> {
    const state = createOAuthState()
    const pkce = createPkcePair()

    await this.database.query({
      text: `INSERT INTO oauth_transactions (
        state_hash, actor_sub, code_verifier_ciphertext, organization_slug, expires_at
      ) VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`,
      values: [
        hashOAuthState(state),
        input.actorSub,
        this.cipher.encrypt(pkce.verifier),
        input.organizationSlug ?? null,
      ],
    })

    return {
      authorizationUrl: this.authorizationUrl({
        challenge: pkce.challenge,
        organizationSlug: input.organizationSlug,
        state,
      }),
    }
  }

  public async completeAuthorization(input: {
    readonly code: string
    readonly correlationId: string
    readonly state: string
  }): Promise<void> {
    return withSpan('oauth.authorization_code_exchange', async () => {
      const transaction = await this.consumeTransaction(input.state, input.correlationId)
      const verifier = this.cipher.decrypt(transaction.code_verifier_ciphertext)
      const tokens = await this.oauthHttp.exchangeAuthorizationCode({
        code: input.code,
        codeVerifier: verifier,
      })

      await this.saveConnectedTokens(transaction.actor_sub, tokens)
      await this.audit.record({
        actorSub: transaction.actor_sub,
        action: 'oauth.connection.created',
        correlationId: input.correlationId,
        outcome: 'success',
        targetType: 'supabase_connection',
      })
    })
  }

  public async getUsableAccessToken(actorSub: string, forceRefresh = false): Promise<string> {
    const connection = await this.findConnection(actorSub)

    if (connection.status !== 'connected') {
      throw this.reauthorizationRequired()
    }

    if (
      !forceRefresh &&
      connection.access_token_ciphertext !== null &&
      connection.access_token_expires_at !== null &&
      connection.access_token_expires_at.getTime() > Date.now() + 60_000
    ) {
      return this.cipher.decrypt(connection.access_token_ciphertext)
    }

    return this.refreshAccessToken(connection)
  }

  public async disconnect(actorSub: string, correlationId: string): Promise<void> {
    const connection = await this.findConnection(actorSub)
    if (connection.refresh_token_ciphertext === null || connection.status === 'revoked') {
      return
    }

    try {
      await this.oauthHttp.revokeAuthorization(
        this.cipher.decrypt(connection.refresh_token_ciphertext),
      )
    } catch (error) {
      await this.database.query({
        text: `UPDATE supabase_connections
               SET status = 'revocation_pending', updated_at = now()
               WHERE actor_sub = $1`,
        values: [actorSub],
      })

      if (error instanceof OAuthHttpError && error.status >= 400 && error.status < 500) {
        await this.audit.record({
          actorSub,
          action: 'oauth.connection.revocation_failed',
          correlationId,
          outcome: 'failure',
          targetType: 'supabase_connection',
          upstreamStatus: error.status,
        })
        throw new AppError({
          code: 'SUPABASE_REVOCATION_FAILED',
          retryable: false,
          status: 502,
          title: 'Supabase authorization could not be revoked',
          type: problem('supabase-revocation-failed'),
        })
      }

      await this.audit.record({
        actorSub,
        action: 'oauth.connection.revocation_pending',
        correlationId,
        outcome: 'failure',
        targetType: 'supabase_connection',
      })
      throw new AppError({
        code: 'SUPABASE_REVOCATION_PENDING',
        retryable: true,
        status: 503,
        title: 'Supabase authorization revocation is pending',
        type: problem('supabase-revocation-pending'),
      })
    }

    await this.database.query({
      text: `UPDATE supabase_connections
             SET status = 'revoked', access_token_ciphertext = NULL, refresh_token_ciphertext = NULL,
                 access_token_expires_at = NULL, revoked_at = now(), updated_at = now()
             WHERE actor_sub = $1`,
      values: [actorSub],
    })
    await this.audit.record({
      actorSub,
      action: 'oauth.connection.revoked',
      correlationId,
      outcome: 'success',
      targetType: 'supabase_connection',
    })
  }

  private authorizationUrl(input: {
    readonly challenge: string
    readonly organizationSlug?: string
    readonly state: string
  }): string {
    return this.oauthHttp.createAuthorizationUrl(input)
  }

  private async consumeTransaction(
    state: string,
    correlationId: string,
  ): Promise<OAuthTransactionRow> {
    const result = await this.database.query<OAuthTransactionRow>({
      text: `UPDATE oauth_transactions
             SET consumed_at = now()
             WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now()
             RETURNING actor_sub, code_verifier_ciphertext`,
      values: [hashOAuthState(state)],
    })
    const transaction = result.rows[0]
    if (transaction === undefined) {
      await this.audit.record({
        actorSub: 'unknown',
        action: 'oauth.state.invalid',
        correlationId,
        outcome: 'failure',
        targetType: 'oauth_state',
      })
      throw new AppError({
        code: 'OAUTH_STATE_INVALID',
        retryable: false,
        status: 400,
        title: 'OAuth state is invalid or expired',
        type: problem('oauth-state-invalid'),
      })
    }
    return transaction
  }

  private async findConnection(actorSub: string): Promise<ConnectionRow> {
    const result = await this.database.query<ConnectionRow>({
      text: `SELECT actor_sub, status, access_token_ciphertext, refresh_token_ciphertext,
                    access_token_expires_at, token_version
             FROM supabase_connections WHERE actor_sub = $1`,
      values: [actorSub],
    })
    const connection = result.rows[0]
    if (connection === undefined) throw this.reauthorizationRequired()
    return connection
  }

  private async refreshAccessToken(connection: ConnectionRow): Promise<string> {
    const existing = this.refreshes.get(connection.actor_sub)
    if (existing !== undefined) return existing

    const refresh = this.performRefresh(connection).finally(() => {
      this.refreshes.delete(connection.actor_sub)
    })
    this.refreshes.set(connection.actor_sub, refresh)
    return refresh
  }

  private async performRefresh(connection: ConnectionRow): Promise<string> {
    return withSpan('oauth.token_refresh', () => this.doPerformRefresh(connection))
  }

  private async doPerformRefresh(connection: ConnectionRow): Promise<string> {
    if (connection.refresh_token_ciphertext === null) throw this.reauthorizationRequired()

    let tokens: OAuthTokenSet
    try {
      tokens = await this.oauthHttp.refreshAccessToken(
        this.cipher.decrypt(connection.refresh_token_ciphertext),
      )
    } catch (error) {
      if (error instanceof OAuthHttpError && error.code === 'invalid_grant') {
        await this.database.query({
          text: `UPDATE supabase_connections
                 SET status = 'revoked', access_token_ciphertext = NULL, refresh_token_ciphertext = NULL,
                     access_token_expires_at = NULL, revoked_at = now(), updated_at = now()
                 WHERE actor_sub = $1`,
          values: [connection.actor_sub],
        })
        throw this.reauthorizationRequired()
      }
      throw new AppError({
        code: 'SUPABASE_TOKEN_REFRESH_FAILED',
        retryable: true,
        status: 503,
        title: 'Supabase token refresh failed',
        type: problem('supabase-token-refresh-failed'),
      })
    }

    const refreshToken =
      tokens.refreshToken ?? this.cipher.decrypt(connection.refresh_token_ciphertext)
    const result = await this.database.query({
      text: `UPDATE supabase_connections
             SET access_token_ciphertext = $1, refresh_token_ciphertext = $2,
                 access_token_expires_at = $3, token_version = token_version + 1,
                 last_refreshed_at = now(), updated_at = now(), status = 'connected'
             WHERE actor_sub = $4 AND token_version = $5 AND status = 'connected'`,
      values: [
        this.cipher.encrypt(tokens.accessToken),
        this.cipher.encrypt(refreshToken),
        new Date(Date.now() + tokens.expiresIn * 1000),
        connection.actor_sub,
        connection.token_version,
      ],
    })
    if (result.rowCount !== 1) {
      throw new AppError({
        code: 'SUPABASE_TOKEN_REFRESH_CONFLICT',
        retryable: true,
        status: 409,
        title: 'Supabase token refresh conflicted',
        type: problem('supabase-token-refresh-conflict'),
      })
    }
    return tokens.accessToken
  }

  private async saveConnectedTokens(
    actorSub: string,
    tokens: Required<OAuthTokenSet>,
  ): Promise<void> {
    await this.database.query({
      text: `INSERT INTO supabase_connections (
               actor_sub, status, access_token_ciphertext, refresh_token_ciphertext,
               access_token_expires_at, token_version, updated_at
             ) VALUES ($1, 'connected', $2, $3, $4, 1, now())
             ON CONFLICT (actor_sub) DO UPDATE SET
               status = 'connected', access_token_ciphertext = EXCLUDED.access_token_ciphertext,
               refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
               access_token_expires_at = EXCLUDED.access_token_expires_at,
               token_version = supabase_connections.token_version + 1,
               revoked_at = NULL, updated_at = now()`,
      values: [
        actorSub,
        this.cipher.encrypt(tokens.accessToken),
        this.cipher.encrypt(tokens.refreshToken),
        new Date(Date.now() + tokens.expiresIn * 1000),
      ],
    })
  }

  private reauthorizationRequired(): AppError {
    return new AppError({
      code: 'SUPABASE_REAUTH_REQUIRED',
      retryable: false,
      status: 409,
      title: 'Supabase reauthorization is required',
      type: problem('supabase-reauth-required'),
    })
  }
}
