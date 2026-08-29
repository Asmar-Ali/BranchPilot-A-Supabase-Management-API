import { createHash } from 'node:crypto'

export interface CreateBranchRequestInput {
  readonly branchName: string
  readonly persistent: boolean
  readonly projectRef: string
  readonly withData: boolean
}

export function hashCreateBranchRequest(input: CreateBranchRequestInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        branchName: input.branchName,
        persistent: input.persistent,
        projectRef: input.projectRef,
        withData: input.withData,
      }),
    )
    .digest('hex')
}
