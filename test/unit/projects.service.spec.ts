import type { ManagementApiClient } from '../../src/management-api/management-api.tokens'
import { ProjectsService } from '../../src/projects/projects.service'

describe('ProjectsService', () => {
  it('returns a stable page and advances the offset only for a full page', async () => {
    const managementApi = {
      listProjects: vi.fn().mockResolvedValue([
        { id: 'project-1', name: 'One', ref: 'one-ref' },
        { id: 'project-2', name: 'Two', ref: 'two-ref' },
      ]),
    } as unknown as ManagementApiClient
    const service = new ProjectsService(managementApi)

    await expect(
      service.list(
        { actorSub: 'user-1', correlationId: '6ca180bf-e2d4-4d61-8efd-e4580a7554c9' },
        { limit: 2, offset: 4, organizationSlug: 'acme' },
      ),
    ).resolves.toEqual({
      items: [
        { id: 'project-1', name: 'One', ref: 'one-ref' },
        { id: 'project-2', name: 'Two', ref: 'two-ref' },
      ],
      page: { limit: 2, nextOffset: 6, offset: 4 },
    })
  })

  it('uses a null next offset for a final partial page', async () => {
    const managementApi = {
      listProjects: vi.fn().mockResolvedValue([{ id: 'project-1', name: 'One', ref: 'one-ref' }]),
    } as unknown as ManagementApiClient
    const service = new ProjectsService(managementApi)

    await expect(
      service.list(
        { actorSub: 'user-1', correlationId: '6ca180bf-e2d4-4d61-8efd-e4580a7554c9' },
        { limit: 2, offset: 0, organizationSlug: 'acme' },
      ),
    ).resolves.toMatchObject({ page: { limit: 2, nextOffset: null, offset: 0 } })
  })
})
