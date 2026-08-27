import { ActorOrIpThrottlerGuard } from '../../src/common/http/throttler.guard'

interface Trackable {
  getTracker(request: Record<string, unknown>): Promise<string>
}

// getTracker() reads no injected state, so a bare prototype stand-in is enough to
// exercise its actor-vs-IP branching without wiring up ThrottlerGuard's own
// constructor (options, storage, reflector) that this logic never touches.
const guard = Object.create(ActorOrIpThrottlerGuard.prototype) as unknown as Trackable

describe('ActorOrIpThrottlerGuard', () => {
  it('tracks by actor sub from request.user', async () => {
    await expect(
      guard.getTracker({ ip: '203.0.113.5', user: { sub: 'user-123' } }),
    ).resolves.toBe('user:user-123')
  })

  it('tracks by actor sub from request.userClaims when request.user is absent', async () => {
    await expect(
      guard.getTracker({ ip: '203.0.113.5', userClaims: { sub: 'user-456' } }),
    ).resolves.toBe('user:user-456')
  })

  it('prefers request.user over request.userClaims when both are present', async () => {
    await expect(
      guard.getTracker({
        ip: '203.0.113.5',
        user: { sub: 'user-123' },
        userClaims: { sub: 'user-456' },
      }),
    ).resolves.toBe('user:user-123')
  })

  it('falls back to the request IP when no actor sub is present', async () => {
    await expect(guard.getTracker({ ip: '203.0.113.5' })).resolves.toBe('ip:203.0.113.5')
  })

  it('falls back to "unknown" when neither an actor nor an IP is present', async () => {
    await expect(guard.getTracker({})).resolves.toBe('ip:unknown')
  })

  it('ignores a malformed actor object with no usable sub', async () => {
    await expect(guard.getTracker({ ip: '203.0.113.5', user: { sub: '' } })).resolves.toBe(
      'ip:203.0.113.5',
    )
  })
})
