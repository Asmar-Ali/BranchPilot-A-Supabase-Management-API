import { normalizeBranchStatus } from '../../src/branches/branch-status'

describe('normalizeBranchStatus', () => {
  it.each([
    ['ACTIVE_HEALTHY', 'ready'],
    ['active_healthy', 'ready'],
    ['PAUSED', 'inactive'],
    ['REMOVED', 'inactive'],
    ['ACTIVE_UNHEALTHY', 'failed'],
    ['MIGRATIONS_FAILED', 'failed'],
    ['INIT_FAILED', 'failed'],
    ['CREATING_PROJECT', 'pending'],
    ['RUNNING_MIGRATIONS', 'pending'],
    ['MIGRATIONS_PASSED', 'pending'],
  ] as const)('maps upstream status %s to %s', (upstream, expected) => {
    expect(normalizeBranchStatus(upstream)).toBe(expected)
  })

  it('falls back to unknown for an unrecognized upstream status', () => {
    expect(normalizeBranchStatus('SOME_FUTURE_STATUS')).toBe('unknown')
  })
})
