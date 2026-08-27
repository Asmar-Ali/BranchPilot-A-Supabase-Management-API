export const MANAGEMENT_API_CLIENT = Symbol('MANAGEMENT_API_CLIENT')

export interface ManagementOrganization {
  readonly id: string
  readonly name: string
  readonly slug: string
}

export interface ManagementProject {
  readonly id: string
  readonly name: string
  readonly ref: string
}

export interface ManagementBranch {
  readonly name: string
  readonly ref: string
  readonly status: string
}

export interface ManagementApiRequestContext {
  readonly actorSub: string
  readonly correlationId: string
}

export interface ManagementApiClient {
  listOrganizations(
    context: ManagementApiRequestContext,
  ): Promise<readonly ManagementOrganization[]>
  listProjects(
    context: ManagementApiRequestContext,
    input: { readonly limit: number; readonly offset: number; readonly organizationSlug: string },
  ): Promise<readonly ManagementProject[]>
  listBranches(
    context: ManagementApiRequestContext,
    projectRef: string,
  ): Promise<readonly ManagementBranch[]>
  createBranch(
    context: ManagementApiRequestContext,
    projectRef: string,
    input: { readonly name: string; readonly persistent: boolean; readonly withData: boolean },
  ): Promise<ManagementBranch>
  getBranch(
    context: ManagementApiRequestContext,
    input: { readonly branchName: string; readonly projectRef: string },
  ): Promise<ManagementBranch>
  deleteBranch(context: ManagementApiRequestContext, branchRef: string): Promise<void>
}
