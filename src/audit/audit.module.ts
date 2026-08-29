import { Module } from '@nestjs/common'

import { DatabaseModule } from '../database/database.module'
import { DatabaseAuditService } from './audit.service'
import { AUDIT_SERVICE } from './audit.tokens'

@Module({
  imports: [DatabaseModule],
  providers: [{ provide: AUDIT_SERVICE, useClass: DatabaseAuditService }],
  exports: [AUDIT_SERVICE],
})
export class AuditModule {}
