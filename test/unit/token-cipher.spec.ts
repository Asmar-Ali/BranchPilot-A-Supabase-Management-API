import { Buffer } from 'node:buffer'

import { TokenCipher } from '../../src/oauth/token-cipher'

describe('TokenCipher', () => {
  const cipher = new TokenCipher(Buffer.alloc(32, 7).toString('base64'))

  it('round trips tokens and uses a new initialization vector each time', () => {
    const first = cipher.encrypt('access-token')
    const second = cipher.encrypt('access-token')

    expect(first.equals(second)).toBe(false)
    expect(cipher.decrypt(first)).toBe('access-token')
    expect(cipher.decrypt(second)).toBe('access-token')
  })

  it('rejects ciphertext modified after encryption', () => {
    const ciphertext = cipher.encrypt('refresh-token')
    const lastByteIndex = ciphertext.length - 1
    ciphertext[lastByteIndex] = ciphertext[lastByteIndex]! ^ 1

    expect(() => cipher.decrypt(ciphertext)).toThrow()
  })
})
