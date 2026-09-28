import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureApplication(
  app: INestApplication,
  config: ConfigService,
): void {
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: config.getOrThrow<string>('CORS_ORIGIN'),
    credentials: true,
  });
  app.enableCsrfProtection({
    trustedOrigins: [config.getOrThrow<string>('CORS_ORIGIN')],
  });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('BTU Course Watch API')
    .setDescription(
      'HTTP API for BTU Course Watch. Login sets HttpOnly access and refresh cookies. Browser clients must send credentials and use the configured trusted frontend origin for unsafe requests.',
    )
    .setVersion('1.0')
    .addCookieAuth(
      'bcw_access',
      { type: 'apiKey', in: 'cookie', name: 'bcw_access' },
      'accessCookie',
    )
    .addCookieAuth(
      'bcw_refresh',
      { type: 'apiKey', in: 'cookie', name: 'bcw_refresh' },
      'refreshCookie',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs/openapi.json',
  });
}
