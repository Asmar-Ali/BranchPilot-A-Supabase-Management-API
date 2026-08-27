import { createHash, randomBytes } from 'node:crypto'

export function createPkcePair(): { readonly challenge: string; readonly verifier: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  return { challenge, verifier }
}

export function hashOAuthState(state: string): Buffer {
  return createHash('sha256').update(state).digest()
}

export function createOAuthState(): string {
  return randomBytes(32).toString('base64url')
}
