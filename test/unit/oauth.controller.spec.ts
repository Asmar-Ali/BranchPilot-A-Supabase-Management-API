import type { SupabaseContext } from '@supabase/server'

import type { AppError } from '../../src/common/errors/app-error'
import { OAuthController } from '../../src/oauth/oauth.controller'
import type { OAuthConnectionService } from '../../src/oauth/oauth-connection.service'

function controllerWith(
  overrides: Partial<
    Pick<OAuthConnectionService, 'completeAuthorization' | 'disconnect' | 'startAuthorization'>
  > = {},
): { controller: OAuthController; oauthConnections: OAuthConnectionService } {
  const oauthConnections = {
    completeAuthorization: vi.fn(),
    disconnect: vi.fn(),
    startAuthorization: vi.fn(),
    ...overrides,
  } as unknown as OAuthConnectionService

  return { controller: new OAuthController(oauthConnections), oauthConnections }
}

describe('OAuthController', () => {
  describe('authorize', () => {
    it('rejects a missing caller identity', () => {
      const { controller } = controllerWith()

      try {
        controller.authorize(null, undefined)
        expect.unreachable('expected authorize to throw for a missing caller identity')
      } catch (error) {
        expect(error).toMatchObject({ code: 'UNAUTHORIZED', status: 401 } satisfies Partial<AppError>)
      }
    })

    it('rejects an organization slug that fails validation', () => {
      const { controller } = controllerWith()
      const userClaims: SupabaseContext['userClaims'] = { id: 'user-1' }

      try {
        controller.authorize(userClaims, 'Not A Valid Slug!')
        expect.unreachable('expected authorize to throw for an invalid slug')
      } catch (error) {
        expect(error).toMatchObject({
          code: 'VALIDATION_FAILED',
          status: 400,
        } satisfies Partial<AppError>)
      }
    })

    it('delegates to OAuthConnectionService with the verified actor', async () => {
      const { controller, oauthConnections } = controllerWith({
        startAuthorization: vi.fn().mockResolvedValue({ authorizationUrl: 'https://example.com' }),
      })
      const userClaims: SupabaseContext['userClaims'] = { id: 'user-1' }

      await expect(controller.authorize(userClaims, 'acme')).resolves.toEqual({
        authorizationUrl: 'https://example.com',
      })
      expect(oauthConnections.startAuthorization).toHaveBeenCalledWith({
        actorSub: 'user-1',
        organizationSlug: 'acme',
      })
    })
  })

  describe('callback', () => {
    it('rejects a missing code or state', async () => {
      const { controller } = controllerWith()

      await expect(controller.callback(undefined, 'state', { headers: {} })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 400,
      } satisfies Partial<AppError>)
      await expect(controller.callback('code', undefined, { headers: {} })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 400,
      } satisfies Partial<AppError>)
      await expect(controller.callback('', '', { headers: {} })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 400,
      } satisfies Partial<AppError>)
    })

    it('completes authorization and reports connected status', async () => {
      const { controller, oauthConnections } = controllerWith()

      await expect(controller.callback('code', 'state', { headers: {} })).resolves.toEqual({
        status: 'connected',
      })
      expect(oauthConnections.completeAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'code', state: 'state' }),
      )
    })
  })

  describe('disconnect', () => {
    it('rejects a missing caller identity', async () => {
      const { controller } = controllerWith()

      await expect(controller.disconnect(null, { headers: {} })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        status: 401,
      } satisfies Partial<AppError>)
    })

    it('delegates disconnect to the verified actor', async () => {
      const { controller, oauthConnections } = controllerWith()
      const userClaims: SupabaseContext['userClaims'] = { id: 'user-1' }

      await controller.disconnect(userClaims, { headers: {} })

      expect(oauthConnections.disconnect).toHaveBeenCalledWith('user-1', expect.any(String))
    })
  })
})
