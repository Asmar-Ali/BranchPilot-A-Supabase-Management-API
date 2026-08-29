import { hashCreateBranchRequest } from '../../src/branches/idempotency'

describe('hashCreateBranchRequest', () => {
  it('produces the same hash for an identical request', () => {
    const input = {
      branchName: 'feature-1',
      persistent: false,
      projectRef: 'project-1',
      withData: false,
    }

    expect(hashCreateBranchRequest(input)).toBe(hashCreateBranchRequest({ ...input }))
  })

  it('produces a different hash when any field differs', () => {
    const base = {
      branchName: 'feature-1',
      persistent: false,
      projectRef: 'project-1',
      withData: false,
    }
    const baseHash = hashCreateBranchRequest(base)

    expect(hashCreateBranchRequest({ ...base, branchName: 'feature-2' })).not.toBe(baseHash)
    expect(hashCreateBranchRequest({ ...base, persistent: true })).not.toBe(baseHash)
    expect(hashCreateBranchRequest({ ...base, projectRef: 'project-2' })).not.toBe(baseHash)
    expect(hashCreateBranchRequest({ ...base, withData: true })).not.toBe(baseHash)
  })
})
