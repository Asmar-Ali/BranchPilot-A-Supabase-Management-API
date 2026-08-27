import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'

import { AppError } from '../common/errors/app-error'
import { APP_CONFIG } from '../config/config.module'
import type { Environment } from '../config/env.schema'
import { OAuthConnectionService } from '../oauth/oauth-connection.service'
import { branchSchema, organizationSchema, projectSchema } from './management-api.schemas'
import type {
  ManagementApiClient,
  ManagementApiRequestContext,
  ManagementBranch,
  ManagementOrganization,
  ManagementProject,
} from './management-api.tokens'
import { RetryPolicy, type RequestMethod } from './retry-policy'

const problem = (name: string): string => `https://branchpilot.dev/problems/${name}`
const requestTimeoutMs = 10_000

interface RequestOptions<Output> {
  readonly body?: unknown
  readonly context: ManagementApiRequestContext
  readonly method: RequestMethod
  readonly path: string
  readonly schema?: z.ZodType<Output>
}

@Injectable()
export class FetchManagementApiClient implements ManagementApiClient {
  public constructor(
    @Inject(OAuthConnectionService) private readonly oauthConnections: OAuthConnectionService,
    @Inject(APP_CONFIG) private readonly config: Environment,
    @Inject(RetryPolicy) private readonly retryPolicy: RetryPolicy,
  ) {}

  public listOrganizations(
    context: ManagementApiRequestContext,
  ): Promise<readonly ManagementOrganization[]> {
    return this.request({
      context,
      method: 'GET',
      path: '/v1/organizations',
      schema: z.array(organizationSchema),
    })
  }

  public listProjects(
    context: ManagementApiRequestContext,
    input: { readonly limit: number; readonly offset: number; readonly organizationSlug: string },
  ): Promise<readonly ManagementProject[]> {
    const query = new URLSearchParams({ limit: String(input.limit), offset: String(input.offset) })
    return this.request({
      context,
      method: 'GET',
      path: `/v1/organizations/${encodeURIComponent(input.organizationSlug)}/projects?${query}`,
      schema: z.array(projectSchema),
    })
  }

  public listBranches(
    context: ManagementApiRequestContext,
    projectRef: string,
  ): Promise<readonly ManagementBranch[]> {
    return this.request({
      context,
      method: 'GET',
      path: `/v1/projects/${encodeURIComponent(projectRef)}/branches`,
      schema: z.array(branchSchema),
    })
  }

  public createBranch(
    context: ManagementApiRequestContext,
    projectRef: string,
    input: { readonly name: string; readonly persistent: boolean; readonly withData: boolean },
  ): Promise<ManagementBranch> {
    return this.request({
      body: { name: input.name, persistent: input.persistent, with_data: input.withData },
      context,
      method: 'POST',
      path: `/v1/projects/${encodeURIComponent(projectRef)}/branches`,
      schema: branchSchema,
    })
  }

  public getBranch(
    context: ManagementApiRequestContext,
    input: { readonly branchName: string; readonly projectRef: string },
  ): Promise<ManagementBranch> {
    return this.request({
      context,
      method: 'GET',
      path: `/v1/projects/${encodeURIComponent(input.projectRef)}/branches/${encodeURIComponent(input.branchName)}`,
      schema: branchSchema,
    })
  }

  public async deleteBranch(
    context: ManagementApiRequestContext,
    branchRef: string,
  ): Promise<void> {
    await this.request({
      context,
      method: 'DELETE',
      path: `/v1/branches/${encodeURIComponent(branchRef)}`,
    })
  }

  private async request<Output>(options: RequestOptions<Output>): Promise<Output> {
    let attempt = 1
    let refreshAfterUnauthorized = false
    let hasRefreshedAfterUnauthorized = false

    while (true) {
      const token = await this.oauthConnections.getUsableAccessToken(
        options.context.actorSub,
        refreshAfterUnauthorized,
      )
      refreshAfterUnauthorized = false

      let response: Response
      try {
        response = await fetch(
          new URL(options.path, this.config.SUPABASE_MANAGEMENT_API_BASE_URL),
          {
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'X-Correlation-Id': options.context.correlationId,
            },
            method: options.method,
            signal: AbortSignal.timeout(requestTimeoutMs),
          },
        )
      } catch {
        const delayMs = this.retryPolicy.nextDelayMs({
          attempt,
          method: options.method,
          networkFailure: true,
        })
        if (delayMs !== undefined) {
          await this.wait(delayMs)
          attempt += 1
          continue
        }
        throw this.upstreamUnavailable()
      }

      if (response.status === 401 && !hasRefreshedAfterUnauthorized) {
        refreshAfterUnauthorized = true
        hasRefreshedAfterUnauthorized = true
        attempt += 1
        continue
      }

      if (response.status === 403) throw this.scopeInsufficient()
      if (response.status === 429) throw this.rateLimited(response)
      if (response.status >= 500) {
        const delayMs = this.retryPolicy.nextDelayMs({
          attempt,
          method: options.method,
          status: response.status,
        })
        if (delayMs !== undefined) {
          await this.wait(delayMs)
          attempt += 1
          continue
        }
        throw this.upstreamUnavailable()
      }
      if (!response.ok) throw this.responseError(response.status)
      if (options.schema === undefined || response.status === 204) return undefined as Output

      const parsed = options.schema.safeParse(await response.json().catch(() => undefined))
      if (!parsed.success) {
        throw new AppError({
          code: 'UPSTREAM_CONTRACT_INVALID',
          retryable: false,
          status: 502,
          title: 'Supabase API returned an unexpected response',
          type: problem('upstream-contract-invalid'),
        })
      }
      return parsed.data
    }
  }

  private async wait(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  }

  private rateLimited(response: Response): AppError {
    const retryAfterSeconds = this.retryPolicy.retryAfterSeconds(
      response.headers.get('retry-after'),
    )
    return new AppError({
      code: 'SUPABASE_RATE_LIMITED',
      extensions: retryAfterSeconds === undefined ? {} : { retryAfterSeconds },
      retryable: true,
      status: 429,
      title: 'Supabase API rate limit exceeded',
      type: problem('upstream-rate-limited'),
    })
  }

  private scopeInsufficient(): AppError {
    return new AppError({
      code: 'SUPABASE_SCOPE_INSUFFICIENT',
      retryable: false,
      status: 403,
      title: 'Supabase authorization lacks the required scope',
      type: problem('supabase-scope-insufficient'),
    })
  }

  private responseError(status: number): AppError {
    if (status === 404) {
      return new AppError({
        code: 'SUPABASE_RESOURCE_NOT_FOUND',
        retryable: false,
        status: 404,
        title: 'Supabase resource was not found',
        type: problem('supabase-resource-not-found'),
      })
    }

    if (status === 401) {
      return new AppError({
        code: 'SUPABASE_REAUTH_REQUIRED',
        retryable: false,
        status: 409,
        title: 'Supabase reauthorization is required',
        type: problem('supabase-reauth-required'),
      })
    }

    return new AppError({
      code: 'SUPABASE_REQUEST_FAILED',
      retryable: false,
      status: 502,
      title: 'Supabase API request failed',
      type: problem('supabase-request-failed'),
    })
  }

  private upstreamUnavailable(): AppError {
    return new AppError({
      code: 'SUPABASE_UPSTREAM_UNAVAILABLE',
      retryable: true,
      status: 503,
      title: 'Supabase API is temporarily unavailable',
      type: problem('supabase-upstream-unavailable'),
    })
  }
}
