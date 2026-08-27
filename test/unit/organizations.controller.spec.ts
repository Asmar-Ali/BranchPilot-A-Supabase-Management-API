import { InternalServerErrorException } from '@nestjs/common'
import type { SupabaseContext } from '@supabase/server'

import type { ManagementApiClient } from '../../src/management-api/management-api.tokens'
import { OrganizationsController } from '../../src/organizations/organizations.controller'

describe('OrganizationsController', () => {
  it('lists organizations for the verified JWT subject', async () => {
    const userClaims: SupabaseContext['userClaims'] = { id: 'a1c2e3f4-0000-4000-8000-000000000000' }
    const managementApi = {
      listOrganizations: vi.fn().mockResolvedValue([{ id: 'org-1', name: 'Acme', slug: 'acme' }]),
    } as unknown as ManagementApiClient
    const controller = new OrganizationsController(managementApi)
    const request = { correlationId: '6ca180bf-e2d4-4d61-8efd-e4580a7554c9' }

    await expect(controller.list(userClaims, request)).resolves.toEqual([
      { id: 'org-1', name: 'Acme', slug: 'acme' },
    ])
    expect(managementApi.listOrganizations).toHaveBeenCalledWith({
      actorSub: userClaims.id,
      correlationId: request.correlationId,
    })
  })

  it('throws when userClaims is null', () => {
    const controller = new OrganizationsController({} as ManagementApiClient)

    expect(() => controller.list(null, {})).toThrow(InternalServerErrorException)
  })
})
