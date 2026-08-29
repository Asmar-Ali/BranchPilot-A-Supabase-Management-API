import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Pool } from 'pg'
import request from 'supertest'

import { AppError } from '../../src/common/errors/app-error'
import { AppModule } from '../../src/app.module'
import { configureHttpApplication } from '../../src/common/http/configure-http-application'
import { APP_CONFIG } from '../../src/config/config.module'
import type { Environment } from '../../src/config/env.schema'
import {
  MANAGEMENT_API_CLIENT,
  type ManagementApiClient,
} from '../../src/management-api/management-api.tokens'
import { createTestDatabasePool, migrateTestDatabase, truncateTables } from '../support/database'

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

const upstreamUnavailable = new AppError({
  code: 'SUPABASE_UPSTREAM_UNAVAILABLE',
  retryable: true,
  status: 503,
  title: 'Supabase API is temporarily unavailable',
  type: 'https://branchpilot.dev/problems/supabase-upstream-unavailable',
})

describe('Branch lifecycle', () => {
  let app: INestApplication
  let pool: Pool
  let privateKey: KeyObject
  let token: string
  let managementApi: {
    createBranch: ReturnType<typeof vi.fn>
    deleteBranch: ReturnType<typeof vi.fn>
    getBranch: ReturnType<typeof vi.fn>
    listBranches: ReturnType<typeof vi.fn>
  }

  beforeAll(async () => {
    const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const publicJwk = keyPair.publicKey.export({ format: 'jwk' })

    Object.assign(publicJwk, { alg: 'RS256', kid: keyId, use: 'sig' })
    process.env.SUPABASE_JWKS = JSON.stringify({ keys: [publicJwk] })
    privateKey = keyPair.privateKey
    token = signedUserToken(privateKey, 'user-1')

    pool = createTestDatabasePool()
    await migrateTestDatabase(pool)

    managementApi = {
      createBranch: vi.fn(),
      deleteBranch: vi.fn(),
      getBranch: vi.fn(),
      listBranches: vi.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MANAGEMENT_API_CLIENT)
      .useValue(managementApi as unknown as ManagementApiClient)
      .compile()

    app = moduleRef.createNestApplication()
    configureHttpApplication(app, app.get<Environment>(APP_CONFIG))
    await app.init()
  })

  afterEach(async () => {
    await truncateTables(pool, ['branch_operations', 'audit_events'])
    vi.resetAllMocks()
  })

  afterAll(async () => {
    delete process.env.SUPABASE_JWKS

    if (app !== undefined) {
      await app.close()
    }
    await pool.end()
  })

  describe('list and observe', () => {
    it('rejects requests without a bearer token', async () => {
      await request(app.getHttpServer())
        .get('/v1/projects/project-1/branches')
        .expect('Content-Type', /application\/problem\+json/)
        .expect(401)
    })

    it('returns normalized branch statuses', async () => {
      managementApi.listBranches.mockResolvedValue([
        { name: 'main', ref: 'ref-main', status: 'ACTIVE_HEALTHY' },
      ])

      const response = await request(app.getHttpServer())
        .get('/v1/projects/project-1/branches')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(response.body).toEqual([{ name: 'main', ref: 'ref-main', status: 'ready' }])
    })

    it('normalizes a single observed branch', async () => {
      managementApi.getBranch.mockResolvedValue({
        name: 'main',
        ref: 'ref-main',
        status: 'RUNNING_MIGRATIONS',
      })

      const response = await request(app.getHttpServer())
        .get('/v1/projects/project-1/branches/main')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(response.body).toEqual({ name: 'main', ref: 'ref-main', status: 'pending' })
    })
  })

  describe('create', () => {
    it('rejects a missing Idempotency-Key header', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/projects/project-1/branches')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'feature-1' })
        .expect('Content-Type', /application\/problem\+json/)
        .expect(400)

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    })

    it('creates a branch and persists the operation', async () => {
      managementApi.createBranch.mockResolvedValue({
        name: 'feature-1',
        ref: 'ref-1',
        status: 'CREATING_PROJECT',
      })

      const response = await request(app.getHttpServer())
        .post('/v1/projects/project-1/branches')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'key-1')
        .send({ name: 'feature-1' })
        .expect(201)

      expect(response.body).toEqual({ name: 'feature-1', ref: 'ref-1', status: 'pending' })
      expect(managementApi.createBranch).toHaveBeenCalledWith(
        expect.objectContaining({ actorSub: 'user-1' }),
        'project-1',
        { name: 'feature-1', persistent: false, withData: false },
      )
      const events = await pool.query('SELECT action FROM audit_events WHERE actor_sub = $1', [
        'user-1',
      ])
      expect(events.rows).toEqual([{ action: 'branch.created' }])
    })

    it('replays a stored result for a repeated idempotency key', async () => {
      managementApi.createBranch.mockResolvedValue({
        name: 'feature-1',
        ref: 'ref-1',
        status: 'ACTIVE_HEALTHY',
      })

      await request(app.getHttpServer())
        .post('/v1/projects/project-1/branches')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'key-2')
        .send({ name: 'feature-1' })
        .expect(201)

      const replay = await request(app.getHttpServer())
        .post('/v1/projects/project-1/branches')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'key-2')
        .send({ name: 'feature-1' })
        .expect(201)

      expect(replay.body).toEqual({ name: 'feature-1', ref: 'ref-1', status: 'ready' })
      expect(managementApi.createBranch).toHaveBeenCalledOnce()
    })

    it('rejects a reused idempotency key sent with a different request', async () => {
      managementApi.createBranch.mockResolvedValue({
        name: 'feature-1',
        ref: 'ref-1',
        status: 'ACTIVE_HEALTHY',
      })

      await request(app.getHttpServer())
        .post('/v1/projects/project-1/branches')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'key-3')
        .send({ name: 'feature-1' })
        .expect(201)

      const response = await request(app.getHttpServer())
        .post('/v1/projects/project-1/branches')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'key-3')
        .send({ name: 'feature-2' })
        .expect('Content-Type', /application\/problem\+json/)
        .expect(409)

      expect(response.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 })
    })

    it('reconciles an ambiguous create failure by matching the branch upstream', async () => {
      managementApi.createBranch.mockRejectedValue(upstreamUnavailable)
      managementApi.listBranches.mockResolvedValue([
        { name: 'feature-1', ref: 'ref-1', status: 'ACTIVE_HEALTHY' },
      ])

      const response = await request(app.getHttpServer())
        .post('/v1/projects/project-1/branches')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'key-4')
        .send({ name: 'feature-1' })
        .expect(201)

      expect(response.body).toEqual({ name: 'feature-1', ref: 'ref-1', status: 'ready' })
    })

    it('returns a retryable unknown outcome when reconciliation finds no match', async () => {
      managementApi.createBranch.mockRejectedValue(upstreamUnavailable)
      managementApi.listBranches.mockResolvedValue([])

      const response = await request(app.getHttpServer())
        .post('/v1/projects/project-1/branches')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'key-5')
        .send({ name: 'feature-1' })
        .expect('Content-Type', /application\/problem\+json/)
        .expect(503)

      expect(response.body).toMatchObject({
        code: 'BRANCH_CREATE_OUTCOME_UNKNOWN',
        retryable: true,
        status: 503,
      })
    })
  })

  describe('delete', () => {
    it('rejects requests without a bearer token', async () => {
      await request(app.getHttpServer())
        .delete('/v1/branches/ref-1')
        .expect('Content-Type', /application\/problem\+json/)
        .expect(401)
    })

    it('deletes the branch and writes an audit event', async () => {
      managementApi.deleteBranch.mockResolvedValue(undefined)

      await request(app.getHttpServer())
        .delete('/v1/branches/ref-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(204)

      expect(managementApi.deleteBranch).toHaveBeenCalledWith(
        expect.objectContaining({ actorSub: 'user-1' }),
        'ref-1',
      )
      const events = await pool.query('SELECT action FROM audit_events WHERE actor_sub = $1', [
        'user-1',
      ])
      expect(events.rows).toEqual([{ action: 'branch.deleted' }])
    })
  })
})
