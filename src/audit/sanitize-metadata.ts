import type { AuditMetadataValue } from './audit.tokens'

const redacted = '[redacted]'

// OAuth access/refresh tokens, authorization codes, and PKCE verifiers are opaque
// strings of this shape. Metadata should only ever carry short, human-meaningful
// values (names, refs, keys), so anything token-shaped is dropped defensively even
// if a caller mistakenly passes one through.
const tokenLikePattern = /^[A-Za-z0-9_-]{32,}(?:\.[A-Za-z0-9_-]{4,}){0,2}$/

export function sanitizeMetadata(
  metadata: Readonly<Record<string, AuditMetadataValue>> | undefined,
): Record<string, AuditMetadataValue> {
  if (metadata === undefined) return {}

  const sanitized: Record<string, AuditMetadataValue> = {}
  for (const [key, value] of Object.entries(metadata)) {
    sanitized[key] = typeof value === 'string' && tokenLikePattern.test(value) ? redacted : value
  }
  return sanitized
}
