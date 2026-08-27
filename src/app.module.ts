import { Module } from '@nestjs/common'

import { HttpConventionsModule } from './common/http/http-conventions.module'
import { AppConfigModule } from './config/config.module'
import { DatabaseModule } from './database/database.module'
import { HealthModule } from './health/health.module'
import { OrganizationsModule } from './organizations/organizations.module'

@Module({
  imports: [
    AppConfigModule,
    HttpConventionsModule,
    DatabaseModule,
    HealthModule,
    OrganizationsModule,
  ],
})
export class AppModule {}
