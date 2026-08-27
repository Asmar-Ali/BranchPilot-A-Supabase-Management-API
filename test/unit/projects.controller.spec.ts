import { InternalServerErrorException } from '@nestjs/common'
import type { SupabaseContext } from '@supabase/server'

import { ProjectsController } from '../../src/projects/projects.controller'
import type { ProjectsService } from '../../src/projects/projects.service'

describe('ProjectsController', () => {
  const userClaims: SupabaseContext['userClaims'] = { id: 'user-1' }
  const request = { correlationId: '6ca180bf-e2d4-4d61-8efd-e4580a7554c9' }

  it('uses validated pagination defaults', async () => {
    const projects = {
      list: vi
        .fn()
        .mockResolvedValue({ items: [], page: { limit: 20, nextOffset: null, offset: 0 } }),
    } as unknown as ProjectsService
    const controller = new ProjectsController(projects)

    await expect(controller.list(userClaims, 'acme', {}, request)).resolves.toEqual({
      items: [],
      page: { limit: 20, nextOffset: null, offset: 0 },
    })
    expect(projects.list).toHaveBeenCalledWith(
      { actorSub: 'user-1', correlationId: request.correlationId },
      { limit: 20, offset: 0, organizationSlug: 'acme' },
    )
  })

  it.each([
    ['invalid slug', 'Acme!', {}],
    ['limit above maximum', 'acme', { limit: '101' }],
    ['negative offset', 'acme', { offset: '-1' }],
    ['unknown query parameter', 'acme', { sort: 'name' }],
  ])('rejects %s', async (_name, slug, query) => {
    const controller = new ProjectsController({} as ProjectsService)

    await expect(controller.list(userClaims, slug, query, request)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    })
  })

  it('fails closed when verified claims are unavailable', async () => {
    const controller = new ProjectsController({} as ProjectsService)

    await expect(controller.list(null, 'acme', {}, request)).rejects.toThrow(
      InternalServerErrorException,
    )
  })
})
