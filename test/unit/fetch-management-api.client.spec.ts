import type { Environment } from '../../src/config/env.schema'
import type { AppError } from '../../src/common/errors/app-error'
import { FetchManagementApiClient } from '../../src/management-api/fetch-management-api.client'
import { RetryPolicy } from '../../src/management-api/retry-policy'
import type { OAuthConnectionService } from '../../src/oauth/oauth-connection.service'

const context = {
  actorSub: 'user-1',
  correlationId: '6ca180bf-e2d4-4d61-8efd-e4580a7554c9',
}

const config = {
  SUPABASE_MANAGEMENT_API_BASE_URL: 'https://management.example.test',
} as Environment

function client(getUsableAccessToken = vi.fn().mockResolvedValue('access-token')) {
  const oauthConnections = { getUsableAccessToken } as unknown as OAuthConnectionService
  return new FetchManagementApiClient(oauthConnections, config, new RetryPolicy())
}

describe('FetchManagementApiClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('adds delegated authorization and correlation metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: 'org-1', name: 'Acme', slug: 'acme' }]), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(client().listOrganizations(context)).resolves.toEqual([
      { id: 'org-1', name: 'Acme', slug: 'acme' },
    ])

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('https://management.example.test/v1/organizations')
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer access-token',
      'X-Correlation-Id': context.correlationId,
    })
  })

  it('refreshes once and replays once after a 401', async () => {
    const getUsableAccessToken = vi
      .fn()
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('fresh-token')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ id: 'org-1', name: 'Acme', slug: 'acme' }]), {
            status: 200,
          }),
        ),
    )

    await expect(client(getUsableAccessToken).listOrganizations(context)).resolves.toHaveLength(1)
    expect(getUsableAccessToken).toHaveBeenNthCalledWith(1, context.actorSub, false)
    expect(getUsableAccessToken).toHaveBeenNthCalledWith(2, context.actorSub, true)
  })

  it('does not duplicate a POST after an upstream failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      client().createBranch(context, 'project-ref', {
        name: 'preview-1',
        persistent: false,
        withData: false,
      }),
    ).rejects.toMatchObject({
      code: 'SUPABASE_UPSTREAM_UNAVAILABLE',
      status: 503,
    } satisfies Partial<AppError>)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a successful response that violates the upstream contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'org-1' }]))),
    )

    await expect(client().listOrganizations(context)).rejects.toMatchObject({
      code: 'UPSTREAM_CONTRACT_INVALID',
      status: 502,
    } satisfies Partial<AppError>)
  })

  it('normalizes a rate limit and exposes a bounded retry delay', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(null, { headers: { 'Retry-After': '90' }, status: 429 })),
    )

    await expect(client().listOrganizations(context)).rejects.toMatchObject({
      code: 'SUPABASE_RATE_LIMITED',
      extensions: { retryAfterSeconds: 60 },
      status: 429,
    } satisfies Partial<AppError>)
  })
})
