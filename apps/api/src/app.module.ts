import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { validateEnvironment } from './config/environment.js';
import { HealthModule } from './health/health.module.js';
import { ExtensionModule } from './extension/extension.module.js';
import { ObservationsModule } from './observations/observations.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { WatchesModule } from './watches/watches.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    ObservationsModule,
    WatchesModule,
    ExtensionModule,
  ],
})
export class AppModule {}
