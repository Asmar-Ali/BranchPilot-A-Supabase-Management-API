import { Inject, Injectable } from '@nestjs/common'

import {
  MANAGEMENT_API_CLIENT,
  type ManagementApiClient,
  type ManagementApiRequestContext,
  type ManagementProject,
} from '../management-api/management-api.tokens'

export interface ProjectPage {
  readonly items: readonly ManagementProject[]
  readonly page: {
    readonly limit: number
    readonly nextOffset: number | null
    readonly offset: number
  }
}

@Injectable()
export class ProjectsService {
  public constructor(
    @Inject(MANAGEMENT_API_CLIENT) private readonly managementApi: ManagementApiClient,
  ) {}

  public async list(
    context: ManagementApiRequestContext,
    input: { readonly limit: number; readonly offset: number; readonly organizationSlug: string },
  ): Promise<ProjectPage> {
    const items = await this.managementApi.listProjects(context, input)

    return {
      items,
      page: {
        limit: input.limit,
        nextOffset: items.length === input.limit ? input.offset + input.limit : null,
        offset: input.offset,
      },
    }
  }
}
