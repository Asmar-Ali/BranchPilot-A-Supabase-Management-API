import { Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'

function actorSubFor(request: Record<string, unknown>): string | undefined {
  for (const key of ['user', 'userClaims']) {
    const candidate = request[key]
    if (typeof candidate !== 'object' || candidate === null || !('sub' in candidate)) {
      continue
    }

    const subject = candidate.sub
    if (typeof subject === 'string' && subject.length > 0) {
      return subject
    }
  }

  return undefined
}

@Injectable()
export class ActorOrIpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(request: Record<string, unknown>): Promise<string> {
    const actorSub = actorSubFor(request)
    if (actorSub !== undefined) {
      return `user:${actorSub}`
    }

    const ip = request['ip']
    return `ip:${typeof ip === 'string' && ip.length > 0 ? ip : 'unknown'}`
  }
}
