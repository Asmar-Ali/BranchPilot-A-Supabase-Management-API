import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { DatabaseModule } from '../database/database.module'
import { ManagementApiModule } from '../management-api/management-api.module'
import { BranchesController } from './branches.controller'
import { BranchesService } from './branches.service'

@Module({
  imports: [AuditModule, DatabaseModule, ManagementApiModule],
  controllers: [BranchesController],
  providers: [BranchesService],
})
export class BranchesModule {}
