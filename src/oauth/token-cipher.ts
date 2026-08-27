import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const AUTH_TAG_BYTES = 16
const INITIALIZATION_VECTOR_BYTES = 12

export class TokenCipher {
  private readonly key: Buffer

  public constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64')
  }

  public encrypt(value: string): Buffer {
    const initializationVector = randomBytes(INITIALIZATION_VECTOR_BYTES)
    const cipher = createCipheriv('aes-256-gcm', this.key, initializationVector)
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])

    return Buffer.concat([initializationVector, cipher.getAuthTag(), ciphertext])
  }

  public decrypt(ciphertext: Buffer): string {
    if (ciphertext.byteLength <= INITIALIZATION_VECTOR_BYTES + AUTH_TAG_BYTES) {
      throw new Error('Encrypted token is malformed')
    }

    const initializationVector = ciphertext.subarray(0, INITIALIZATION_VECTOR_BYTES)
    const authTag = ciphertext.subarray(
      INITIALIZATION_VECTOR_BYTES,
      INITIALIZATION_VECTOR_BYTES + AUTH_TAG_BYTES,
    )
    const encryptedValue = ciphertext.subarray(INITIALIZATION_VECTOR_BYTES + AUTH_TAG_BYTES)
    const decipher = createDecipheriv('aes-256-gcm', this.key, initializationVector)
    decipher.setAuthTag(authTag)

    return Buffer.concat([decipher.update(encryptedValue), decipher.final()]).toString('utf8')
  }
}
