import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/app.module'
import { configureHttpApplication } from '../../src/common/http/configure-http-application'
import { APP_CONFIG } from '../../src/config/config.module'
import type { Environment } from '../../src/config/env.schema'

const keyId = 'branchpilot-test-key'

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function signedUserToken(privateKey: KeyObject, actorSub: string): string {
  const header = base64UrlJson({ alg: 'RS256', kid: keyId, typ: 'JWT' })
  const payload = base64UrlJson({
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    iat: Math.floor(Date.now() / 1000),
    role: 'authenticated',
    sub: actorSub,
  })
  const signingInput = `${header}.${payload}`
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .end()
    .sign(privateKey, 'base64url')

  return `${signingInput}.${signature}`
}

describe('Organizations authentication', () => {
  let app: INestApplication
  let privateKey: KeyObject

  beforeAll(async () => {
    const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const publicJwk = keyPair.publicKey.export({ format: 'jwk' })

    Object.assign(publicJwk, { alg: 'RS256', kid: keyId, use: 'sig' })
    process.env.SUPABASE_JWKS = JSON.stringify({ keys: [publicJwk] })
    privateKey = keyPair.privateKey

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication()
    configureHttpApplication(app, app.get<Environment>(APP_CONFIG))
    await app.init()
  })

  afterAll(async () => {
    delete process.env.SUPABASE_JWKS

    if (app !== undefined) {
      await app.close()
    }
  })

  it('rejects requests without a bearer token', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/organizations')
      .expect('Content-Type', /application\/problem\+json/)
      .expect(401)

    expect(response.body).toMatchObject({
      code: 'UNAUTHORIZED',
      retryable: false,
      status: 401,
      title: 'Authentication is required',
      type: 'https://branchpilot.dev/problems/unauthorized',
    })
  })

  it('rejects requests with an invalid bearer token', async () => {
    await request(app.getHttpServer())
      .get('/v1/organizations')
      .set('Authorization', 'Bearer not-a-valid-jwt')
      .expect('Content-Type', /application\/problem\+json/)
      .expect(401)
  })

  it('uses the verified JWT subject as actor_sub', async () => {
    const actorSub = '3e9a05c3-6544-44f7-a6ed-443c84f86f92'
    const token = signedUserToken(privateKey, actorSub)

    await request(app.getHttpServer())
      .get('/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect({ actor_sub: actorSub })
  })

  it('keeps health liveness public', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({ status: 'ok' })
  })
})
