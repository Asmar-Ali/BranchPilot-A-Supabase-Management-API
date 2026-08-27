export const OAUTH_HTTP_CLIENT = Symbol('OAUTH_HTTP_CLIENT')

export interface OAuthTokenSet {
  readonly accessToken: string
  readonly expiresIn: number
  readonly refreshToken?: string
}

export interface OAuthHttpClient {
  createAuthorizationUrl(input: {
    readonly challenge: string
    readonly organizationSlug?: string
    readonly state: string
  }): string
  exchangeAuthorizationCode(input: {
    readonly code: string
    readonly codeVerifier: string
  }): Promise<Required<OAuthTokenSet>>
  refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet>
  revokeAuthorization(refreshToken: string): Promise<void>
}
