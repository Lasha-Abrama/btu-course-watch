import type { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import { SessionService } from '../src/auth/session.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Notification web HTTP boundary (e2e)', () => {
  let app: INestApplication;
  const id = randomUUID();
  const list = vi.fn(async () => ({
    items: [],
    unreadCount: 0,
    nextCursor: null,
  }));
  const markRead = vi.fn(async () => {});
  const markAllRead = vi.fn(async () => {});
  const web = {
    Cookie: 'bcw_access=web-session',
    Origin: 'http://localhost:3000',
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: async () => {}, $disconnect: async () => {} })
      .overrideProvider(SessionService)
      .useValue({
        authenticate: async (token: string | undefined) => {
          if (token !== 'web-session')
            throw new UnauthorizedException('Authentication required');
          return {
            id: 'owner-id',
            email: 'student@btu.edu.ge',
            emailVerifiedAt: new Date(),
          };
        },
      })
      .overrideProvider(NotificationsService)
      .useValue({ list, markRead, markAllRead })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, app.get(ConfigService));
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(() => {
    list.mockClear();
    markRead.mockClear();
    markAllRead.mockClear();
  });
  afterAll(async () => app.close());

  it('requires a web session and scopes all actions to its user', async () => {
    await request(app.getHttpServer()).get('/api/v1/notifications').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', 'Bearer extension-secret')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/notifications?limit=5')
      .set(web)
      .expect(200, { items: [], unreadCount: 0, nextCursor: null });
    expect(list).toHaveBeenCalledWith('owner-id', { limit: '5' });
    await request(app.getHttpServer())
      .put(`/api/v1/notifications/${id}/read`)
      .set(web)
      .expect(204);
    expect(markRead).toHaveBeenCalledWith('owner-id', id);
    await request(app.getHttpServer())
      .put('/api/v1/notifications/read-all')
      .set(web)
      .expect(204);
    expect(markAllRead).toHaveBeenCalledWith('owner-id');
  });

  it('keeps unsafe actions behind origin checks', async () => {
    await request(app.getHttpServer())
      .put(`/api/v1/notifications/${id}/read`)
      .set({ ...web, Origin: 'https://evil.example' })
      .expect(403);
    await request(app.getHttpServer())
      .put('/api/v1/notifications/read-all')
      .set({ ...web, Origin: 'https://evil.example' })
      .expect(403);
    expect(markRead).not.toHaveBeenCalled();
    expect(markAllRead).not.toHaveBeenCalled();
  });

  it('documents the cookie-authenticated alert routes in OpenAPI', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs/openapi.json')
      .expect(200);
    expect(response.body.paths).toHaveProperty('/api/v1/notifications');
    expect(response.body.paths).toHaveProperty(
      '/api/v1/notifications/read-all',
    );
    expect(response.body.paths).toHaveProperty(
      '/api/v1/notifications/{notificationId}/read',
    );
    expect(
      response.body.paths['/api/v1/notifications'].get.security,
    ).toContainEqual({
      accessCookie: [],
    });
  });
});
