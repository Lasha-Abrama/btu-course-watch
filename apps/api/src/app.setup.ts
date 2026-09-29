import { RequestMethod, type INestApplication } from '@nestjs/common';
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
    // These exact routes accept no web cookies and require an extension verifier/bearer.
    exclude: [
      { path: 'extension/link-requests', method: RequestMethod.POST },
      {
        path: 'extension/link-requests/:requestId/exchange',
        method: RequestMethod.POST,
      },
      { path: 'extension/observations', method: RequestMethod.POST },
    ],
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
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'opaque extension credential',
      },
      'extensionCredential',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs/openapi.json',
  });
}
