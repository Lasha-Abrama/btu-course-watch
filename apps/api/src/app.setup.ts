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
  });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('BTU Course Watch API')
    .setDescription('HTTP API for the BTU Course Watch platform.')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs/openapi.json',
  });
}
