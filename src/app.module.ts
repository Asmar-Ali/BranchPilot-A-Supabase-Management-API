import { Module } from '@nestjs/common'

import { BranchesModule } from './branches/branches.module'
import { HttpConventionsModule } from './common/http/http-conventions.module'
import { AppConfigModule } from './config/config.module'
import { DatabaseModule } from './database/database.module'
import { HealthModule } from './health/health.module'
import { OAuthModule } from './oauth/oauth.module'
import { OrganizationsModule } from './organizations/organizations.module'
import { ProjectsModule } from './projects/projects.module'

@Module({
  imports: [
    AppConfigModule,
    HttpConventionsModule,
    DatabaseModule,
    HealthModule,
    OAuthModule,
    OrganizationsModule,
    ProjectsModule,
    BranchesModule,
  ],
})
export class AppModule {}
