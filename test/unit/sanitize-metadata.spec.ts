import { sanitizeMetadata } from '../../src/audit/sanitize-metadata'

describe('sanitizeMetadata', () => {
  it('returns an empty object when no metadata is given', () => {
    expect(sanitizeMetadata(undefined)).toEqual({})
  })

  it('passes short, human-meaningful values through unchanged', () => {
    expect(sanitizeMetadata({ count: 3, enabled: true, projectRef: 'abcdefgh' })).toEqual({
      count: 3,
      enabled: true,
      projectRef: 'abcdefgh',
    })
  })

  it('redacts long opaque strings shaped like access/refresh tokens', () => {
    const opaqueToken = 'x'.repeat(48)
    expect(sanitizeMetadata({ token: opaqueToken })).toEqual({ token: '[redacted]' })
  })

  it('redacts JWT-shaped dot-separated strings', () => {
    const jwtLike = `${'a'.repeat(36)}.${'b'.repeat(20)}.${'c'.repeat(20)}`
    expect(sanitizeMetadata({ credential: jwtLike })).toEqual({ credential: '[redacted]' })
  })
})
