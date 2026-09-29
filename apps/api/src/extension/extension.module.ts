import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ObservationsModule } from '../observations/observations.module.js';
import { ExtensionAuthService } from './extension-auth.service.js';
import {
  ExtensionClientController,
  ExtensionWebController,
} from './extension.controller.js';
import {
  ExtensionCredentialGuard,
  ExtensionTransportGuard,
} from './extension.guards.js';

@Module({
  imports: [AuthModule, ObservationsModule],
  controllers: [ExtensionClientController, ExtensionWebController],
  providers: [
    ExtensionAuthService,
    ExtensionCredentialGuard,
    ExtensionTransportGuard,
  ],
})
export class ExtensionModule {}
