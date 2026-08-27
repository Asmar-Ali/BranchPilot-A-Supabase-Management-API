import { createHash } from 'node:crypto'

import { createOAuthState, createPkcePair, hashOAuthState } from '../../src/oauth/pkce'

describe('OAuth PKCE helpers', () => {
  it('creates an S256 challenge for an opaque verifier', () => {
    const pair = createPkcePair()

    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(pair.challenge).toBe(createHash('sha256').update(pair.verifier).digest('base64url'))
  })

  it('creates independent opaque states and hashes them with SHA-256', () => {
    const first = createOAuthState()
    const second = createOAuthState()

    expect(first).not.toBe(second)
    expect(hashOAuthState(first)).toEqual(createHash('sha256').update(first).digest())
  })
})
