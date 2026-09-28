import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: () => Promise.resolve(),
        $disconnect: () => Promise.resolve(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app, app.get(ConfigService));
    await app.listen(0, '127.0.0.1');
  });

  it('GET /api/v1/health', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'btu-course-watch-api',
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
  });

  it('GET /api/docs', async () => {
    await request(app.getHttpServer())
      .get('/api/docs')
      .expect('content-type', /html/)
      .expect(200);
  });

  it('GET /api/docs/openapi.json', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs/openapi.json')
      .expect(200);

    expect(response.body.info).toMatchObject({
      title: 'BTU Course Watch API',
      version: '1.0',
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
