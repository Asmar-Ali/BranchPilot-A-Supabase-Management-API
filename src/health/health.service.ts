import { Injectable } from '@nestjs/common'

@Injectable()
export class HealthService {
  public live(): { status: 'ok' } {
    return { status: 'ok' }
  }
}
