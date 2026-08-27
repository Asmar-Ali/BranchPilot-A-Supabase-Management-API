import { Module } from '@nestjs/common'

import { ManagementApiModule } from '../management-api/management-api.module'
import { OrganizationsController } from './organizations.controller'

@Module({
  imports: [ManagementApiModule],
  controllers: [OrganizationsController],
})
export class OrganizationsModule {}
