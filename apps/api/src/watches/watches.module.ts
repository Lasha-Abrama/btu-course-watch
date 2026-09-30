import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WatchesController } from './watches.controller.js';
import { WatchesService } from './watches.service.js';

@Module({
  imports: [AuthModule],
  controllers: [WatchesController],
  providers: [WatchesService],
  exports: [WatchesService],
})
export class WatchesModule {}
