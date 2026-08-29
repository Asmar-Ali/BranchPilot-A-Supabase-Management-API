import { InternalServerErrorException } from '@nestjs/common'
import type { SupabaseContext } from '@supabase/server'

import { BranchesController } from '../../src/branches/branches.controller'
import type { BranchesService } from '../../src/branches/branches.service'

describe('BranchesController', () => {
  const userClaims: SupabaseContext['userClaims'] = { id: 'user-1' }
  const request = { correlationId: '6ca180bf-e2d4-4d61-8efd-e4580a7554c9' }

  describe('list', () => {
    it('delegates to BranchesService with the verified actor', async () => {
      const branches = {
        list: vi.fn().mockResolvedValue([{ name: 'main', ref: 'ref-1', status: 'ready' }]),
      } as unknown as BranchesService
      const controller = new BranchesController(branches)

      await expect(controller.list(userClaims, 'project-1', request)).resolves.toEqual([
        { name: 'main', ref: 'ref-1', status: 'ready' },
      ])
      expect(branches.list).toHaveBeenCalledWith(
        { actorSub: 'user-1', correlationId: request.correlationId },
        'project-1',
      )
    })

    it('rejects an invalid project ref', async () => {
      const controller = new BranchesController({} as BranchesService)

      await expect(controller.list(userClaims, 'not a ref!', request)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 400,
      })
    })

    it('fails closed when verified claims are unavailable', async () => {
      const controller = new BranchesController({} as BranchesService)

      await expect(controller.list(null, 'project-1', request)).rejects.toThrow(
        InternalServerErrorException,
      )
    })
  })

  describe('get', () => {
    it('delegates to BranchesService with the verified actor', async () => {
      const branches = {
        get: vi.fn().mockResolvedValue({ name: 'main', ref: 'ref-1', status: 'ready' }),
      } as unknown as BranchesService
      const controller = new BranchesController(branches)

      await expect(controller.get(userClaims, 'project-1', 'main', request)).resolves.toEqual({
        name: 'main',
        ref: 'ref-1',
        status: 'ready',
      })
      expect(branches.get).toHaveBeenCalledWith(
        { actorSub: 'user-1', correlationId: request.correlationId },
        { branchName: 'main', projectRef: 'project-1' },
      )
    })

    it('rejects an invalid branch name', async () => {
      const controller = new BranchesController({} as BranchesService)

      await expect(
        controller.get(userClaims, 'project-1', 'not a name!', request),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    })
  })

  describe('create', () => {
    it('defaults persistent/withData and delegates with the idempotency key', async () => {
      const branches = {
        create: vi.fn().mockResolvedValue({ name: 'feature-1', ref: 'ref-1', status: 'pending' }),
      } as unknown as BranchesService
      const controller = new BranchesController(branches)

      await expect(
        controller.create(userClaims, 'project-1', 'key-1', { name: 'feature-1' }, request),
      ).resolves.toEqual({ name: 'feature-1', ref: 'ref-1', status: 'pending' })
      expect(branches.create).toHaveBeenCalledWith(
        { actorSub: 'user-1', correlationId: request.correlationId },
        {
          branchName: 'feature-1',
          idempotencyKey: 'key-1',
          persistent: false,
          projectRef: 'project-1',
          withData: false,
        },
      )
    })

    it('rejects a missing Idempotency-Key header', async () => {
      const controller = new BranchesController({} as BranchesService)

      await expect(
        controller.create(userClaims, 'project-1', undefined, { name: 'feature-1' }, request),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    })

    it('rejects an empty Idempotency-Key header', async () => {
      const controller = new BranchesController({} as BranchesService)

      await expect(
        controller.create(userClaims, 'project-1', '', { name: 'feature-1' }, request),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    })

    it('rejects an invalid request body', async () => {
      const controller = new BranchesController({} as BranchesService)

      await expect(
        controller.create(userClaims, 'project-1', 'key-1', { name: '' }, request),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
      await expect(
        controller.create(userClaims, 'project-1', 'key-1', { name: 'ok', extra: true }, request),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    })
  })

  describe('delete', () => {
    it('delegates to BranchesService with the verified actor', async () => {
      const branches = { delete: vi.fn().mockResolvedValue(undefined) } as unknown as BranchesService
      const controller = new BranchesController(branches)

      await controller.delete(userClaims, 'ref-1', request)

      expect(branches.delete).toHaveBeenCalledWith(
        { actorSub: 'user-1', correlationId: request.correlationId },
        'ref-1',
      )
    })

    it('rejects an invalid branch ref', async () => {
      const controller = new BranchesController({} as BranchesService)

      await expect(controller.delete(userClaims, 'not a ref!', request)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 400,
      })
    })
  })
})
