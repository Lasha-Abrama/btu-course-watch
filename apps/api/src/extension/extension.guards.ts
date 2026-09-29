import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ExtensionAuthService,
  type ExtensionIdentity,
} from './extension-auth.service.js';

export interface ExtensionRequest extends Request {
  extensionId: string;
  extensionIdentity?: ExtensionIdentity;
}

/** Dedicated bearer routes cannot inherit web cookies or trusted-web-origin CSRF exemptions. */
@Injectable()
export class ExtensionTransportGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ExtensionRequest>();
    const extensionId = request.headers['x-bcw-extension-id'];
    if (
      typeof extensionId !== 'string' ||
      !/^[a-p]{32}$/.test(extensionId) ||
      request.headers.cookie ||
      (request.headers.origin &&
        request.headers.origin !== `chrome-extension://${extensionId}`)
    ) {
      throw new ForbiddenException('Extension request not permitted');
    }
    request.extensionId = extensionId;
    return true;
  }
}

@Injectable()
export class ExtensionCredentialGuard implements CanActivate {
  constructor(private readonly credentials: ExtensionAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ExtensionRequest>();
    const match = /^Bearer (bcwx_[A-Za-z0-9_-]{43})$/.exec(
      request.headers.authorization ?? '',
    );
    if (!match)
      throw new UnauthorizedException('Extension authorization required');
    request.extensionIdentity = await this.credentials.authenticate(
      match[1],
      request.extensionId,
    );
    return true;
  }
}
