import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { SessionService } from '../auth/session.service.js';
import { ObservationsController } from './observations.controller.js';
import { ObservationsService } from './observations.service.js';

@Module({
  controllers: [ObservationsController],
  providers: [ObservationsService, SessionGuard, SessionService],
  exports: [ObservationsService],
})
export class ObservationsModule {}
