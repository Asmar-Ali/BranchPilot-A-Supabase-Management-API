import { Module } from '@nestjs/common'

import { ManagementApiModule } from '../management-api/management-api.module'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'

@Module({
  imports: [ManagementApiModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
