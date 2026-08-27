import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'

import { APP_CONFIG } from '../config/config.module'
import type { Environment } from '../config/env.schema'
import type { OAuthHttpClient, OAuthTokenSet } from './oauth.tokens'

const authorizationEndpoint = 'https://api.supabase.com/v1/oauth/authorize'
const revocationEndpoint = 'https://api.supabase.com/v1/oauth/revoke'
const tokenEndpoint = 'https://api.supabase.com/v1/oauth/token'

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
})

export class OAuthHttpError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code)
    this.name = 'OAuthHttpError'
  }
}

@Injectable()
export class SupabaseOAuthHttpClient implements OAuthHttpClient {
  public constructor(@Inject(APP_CONFIG) private readonly config: Environment) {}

  public async exchangeAuthorizationCode(input: {
    readonly code: string
    readonly codeVerifier: string
  }): Promise<Required<OAuthTokenSet>> {
    const tokens = await this.requestTokens({
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: this.config.SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI,
    })

    if (tokens.refreshToken === undefined) {
      throw new OAuthHttpError('invalid_token_response', 502)
    }

    return tokens as Required<OAuthTokenSet>
  }

  public refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet> {
    return this.requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken })
  }

  public async revokeAuthorization(refreshToken: string): Promise<void> {
    const response = await fetch(revocationEndpoint, {
      body: JSON.stringify({
        client_id: this.config.SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID,
        client_secret: this.config.SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET,
        refresh_token: refreshToken,
      }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      throw await this.toHttpError(response)
    }
  }

  public createAuthorizationUrl(input: {
    readonly challenge: string
    readonly organizationSlug?: string
    readonly state: string
  }): string {
    const url = new URL(authorizationEndpoint)
    url.search = new URLSearchParams({
      client_id: this.config.SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID,
      code_challenge: input.challenge,
      code_challenge_method: 'S256',
      redirect_uri: this.config.SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI,
      response_type: 'code',
      state: input.state,
    }).toString()

    if (input.organizationSlug !== undefined) {
      url.searchParams.set('organization_slug', input.organizationSlug)
    }

    return url.toString()
  }

  private async requestTokens(parameters: Record<string, string>): Promise<OAuthTokenSet> {
    const basicCredentials = Buffer.from(
      `${this.config.SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID}:${this.config.SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET}`,
    ).toString('base64')
    const response = await fetch(tokenEndpoint, {
      body: new URLSearchParams(parameters),
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${basicCredentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      throw await this.toHttpError(response)
    }

    const result = tokenResponseSchema.safeParse(await response.json())
    if (!result.success) {
      throw new OAuthHttpError('invalid_token_response', 502)
    }

    return {
      accessToken: result.data.access_token,
      expiresIn: result.data.expires_in,
      refreshToken: result.data.refresh_token,
    }
  }

  private async toHttpError(response: Response): Promise<OAuthHttpError> {
    const body: unknown = await response.json().catch(() => undefined)
    const code =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'oauth_request_failed'

    return new OAuthHttpError(code, response.status)
  }
}
