export type NormalizedBranchStatus = 'failed' | 'inactive' | 'pending' | 'ready' | 'unknown'

const readyStatuses = new Set(['ACTIVE_HEALTHY'])
const inactiveStatuses = new Set(['PAUSED', 'REMOVED'])
const pendingStatuses = new Set([
  'CREATING_PROJECT',
  'FUNCTIONS_DEPLOYED',
  'GOING_DOWN',
  'MIGRATIONS_PASSED',
  'PAUSING',
  'RESTORING',
  'RUNNING_MIGRATIONS',
])

/**
 * Best-effort mapping from Supabase's upstream branch status vocabulary to the small
 * public set this API commits to. The raw value is always kept alongside this in the
 * `branch_operations` record, so an unrecognized or future upstream value safely falls
 * back to `unknown` rather than failing the request.
 */
export function normalizeBranchStatus(upstreamStatus: string): NormalizedBranchStatus {
  const status = upstreamStatus.trim().toUpperCase()

  if (readyStatuses.has(status)) return 'ready'
  if (inactiveStatuses.has(status)) return 'inactive'
  if (status.includes('FAILED') || status === 'ACTIVE_UNHEALTHY') return 'failed'
  if (pendingStatuses.has(status)) return 'pending'

  return 'unknown'
}
