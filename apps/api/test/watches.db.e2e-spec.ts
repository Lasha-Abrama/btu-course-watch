import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import { SessionService } from '../src/auth/session.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const testUrl = process.env.OBSERVATION_TEST_DATABASE_URL;
const available =
  testUrl && new URL(testUrl).pathname === '/btu_course_watch_phase5a_test';
const extensionId = 'a'.repeat(32);
const credential = `bcwx_${'C'.repeat(43)}`;

describe.skipIf(!available)('Owned watches with PostgreSQL (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const users = [randomUUID(), randomUUID()];
  const courses = [
    `test_${randomUUID().replaceAll('-', '')}`,
    `test_${randomUUID().replaceAll('-', '')}`,
  ];
  const groups = [randomUUID(), randomUUID()];
  let credentialId: string;
  const body = (course = courses[0]) => ({
    btuCourseId: course,
    btuGroupId: 'shared-group',
  });
  const web = (user = 0) => ({
    Cookie: `bcw_access=user-${user}`,
    Origin: 'http://localhost:3000',
  });
  const ext = (token = credential) => ({
    'X-BCW-Extension-Id': extensionId,
    Origin: `chrome-extension://${extensionId}`,
    Authorization: `Bearer ${token}`,
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
    await prisma.$connect();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(SessionService)
      .useValue({
        authenticate: async (token: string | undefined) => {
          const match = /^user-([01])$/.exec(token ?? '');
          if (!match)
            throw new UnauthorizedException('Authentication required');
          const index = Number(match[1]);
          return {
            id: users[index],
            email: `test-${index}@btu.edu.ge`,
            emailVerifiedAt: new Date(),
          };
        },
      })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, app.get(ConfigService));
    await app.listen(0, '127.0.0.1');
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        email: `${id}-${index}@btu.edu.ge`,
        emailVerifiedAt: new Date(),
      })),
    });
    for (let index = 0; index < 2; index++) {
      await prisma.course.create({
        data: {
          btuCourseId: courses[index],
          lastObservedAt: new Date(),
          groups: {
            create: {
              id: groups[index],
              btuGroupId: 'shared-group',
              name: `Group ${index}`,
              capacity: 27,
              status: 'FULL',
              firstObservedAt: new Date(),
              lastObservedAt: new Date(),
            },
          },
        },
      });
    }
    credentialId = (
      await prisma.extensionObservationCredential.create({
        data: {
          userId: users[0],
          installationId: randomUUID(),
          extensionId,
          tokenHash: createHash('sha256').update(credential).digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
        },
      })
    ).id;
  });
  beforeEach(async () => {
    await prisma.watch.deleteMany({ where: { userId: { in: users } } });
    await prisma.group.updateMany({
      where: { id: { in: groups } },
      data: { status: 'FULL' },
    });
    await prisma.extensionObservationCredential.update({
      where: { id: credentialId },
      data: { revokedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    });
  });
  afterAll(async () => {
    await prisma.course.deleteMany({ where: { btuCourseId: { in: courses } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await app.close();
    await prisma.$disconnect();
  });

  it('creates once under concurrent retries, scopes identity to a course, and reads current canonical state', async () => {
    const [first, second] = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .put('/api/v1/watches')
          .set(web())
          .send(body())
          .expect(200),
      ),
    );
    expect(first.body.id).toBe(second.body.id);
    expect(await prisma.watch.count({ where: { userId: users[0] } })).toBe(1);
    expect(JSON.stringify(first.body)).not.toMatch(
      /chooseUrl|tokenHash|password|userId/,
    );
    const otherCourse = await request(app.getHttpServer())
      .put('/api/v1/watches')
      .set(web())
      .send(body(courses[1]))
      .expect(200);
    expect(otherCourse.body.id).not.toBe(first.body.id);
    await prisma.group.update({
      where: { id: groups[0] },
      data: { status: 'AVAILABLE', lastObservedAt: new Date() },
    });
    const list = await request(app.getHttpServer())
      .get('/api/v1/watches')
      .set(web())
      .expect(200);
    expect(list.body).toHaveLength(2);
    expect(
      list.body.find(
        (item: { btuCourseId: string }) => item.btuCourseId === courses[0],
      ).status,
    ).toBe('AVAILABLE');
    expect(
      list.body.find(
        (item: { btuCourseId: string }) => item.btuCourseId === courses[1],
      ).status,
    ).toBe('FULL');
  });

  it('isolates users and makes own unwatch and retry idempotent', async () => {
    const own = await request(app.getHttpServer())
      .put('/api/v1/watches')
      .set(web())
      .send(body())
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/watches')
      .set(web(1))
      .expect(200, []);
    await request(app.getHttpServer())
      .delete(`/api/v1/watches/${own.body.id}`)
      .set(web(1))
      .expect(204);
    expect(await prisma.watch.count({ where: { id: own.body.id } })).toBe(1);
    await request(app.getHttpServer())
      .delete(`/api/v1/watches/${own.body.id}`)
      .set(web())
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/v1/watches/${own.body.id}`)
      .set(web())
      .expect(204);
    expect(await prisma.watch.count({ where: { id: own.body.id } })).toBe(0);
  });

  it('rejects unknown groups, extra fields, unauthenticated and untrusted web requests', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/watches')
      .set(web())
      .send({ ...body(), btuGroupId: 'missing' })
      .expect(404);
    await request(app.getHttpServer())
      .put('/api/v1/watches')
      .set(web())
      .send({ ...body(), userId: users[1] })
      .expect(400);
    await request(app.getHttpServer())
      .put('/api/v1/watches')
      .set(web())
      .send({ ...body(), btuCourseId: '../bad' })
      .expect(400);
    await request(app.getHttpServer()).get('/api/v1/watches').expect(401);
    await request(app.getHttpServer())
      .delete(`/api/v1/watches/${randomUUID()}`)
      .set({ ...web(), Origin: 'https://evil.example' })
      .expect(403);
    await request(app.getHttpServer())
      .put('/api/v1/watches')
      .send(body())
      .expect(401);
    await request(app.getHttpServer())
      .put('/api/v1/watches')
      .set({ ...web(), Origin: 'https://evil.example' })
      .send(body())
      .expect(403);
    expect(await prisma.watch.count({ where: { userId: users[0] } })).toBe(0);
  });

  it('limits extension bearer access to owned watch routes and rejects revoked, expired, and web credentials', async () => {
    const created = await request(app.getHttpServer())
      .put('/api/v1/extension/watches')
      .set(ext())
      .send(body())
      .expect(200);
    expect(created.body.btuCourseId).toBe(courses[0]);
    await request(app.getHttpServer())
      .put('/api/v1/watches')
      .set(web(1))
      .send(body(courses[1]))
      .expect(200);
    const owned = await request(app.getHttpServer())
      .get('/api/v1/extension/watches')
      .set(ext())
      .expect(200);
    expect(owned.body).toHaveLength(1);
    expect(owned.body[0].btuCourseId).toBe(courses[0]);
    await request(app.getHttpServer())
      .get('/api/v1/watches')
      .set(ext())
      .expect(401);
    await request(app.getHttpServer())
      .put('/api/v1/extension/watches')
      .set({ ...ext(), Cookie: 'bcw_access=user-0' })
      .send(body())
      .expect(403);
    await request(app.getHttpServer())
      .put('/api/v1/extension/watches')
      .set({ 'X-BCW-Extension-Id': extensionId, Cookie: 'bcw_access=user-0' })
      .send(body())
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/extension/watches')
      .set(ext('bcwx_invalid'))
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/api/v1/extension/watches/${created.body.id}`)
      .set(ext())
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/v1/extension/watches/${created.body.id}`)
      .set(ext())
      .expect(204);
    await prisma.extensionObservationCredential.update({
      where: { id: credentialId },
      data: { revokedAt: new Date() },
    });
    await request(app.getHttpServer())
      .get('/api/v1/extension/watches')
      .set(ext())
      .expect(401);
    await request(app.getHttpServer())
      .put('/api/v1/extension/watches')
      .set(ext())
      .send(body())
      .expect(401);
    await prisma.extensionObservationCredential.update({
      where: { id: credentialId },
      data: { revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer())
      .get('/api/v1/extension/watches')
      .set(ext())
      .expect(401);
  });

  it('documents separate cookie and extension-bearer watch security in OpenAPI', async () => {
    const { body: doc } = await request(app.getHttpServer())
      .get('/api/docs/openapi.json')
      .expect(200);
    expect(doc.paths['/api/v1/watches'].put.security).toEqual([
      { accessCookie: [] },
    ]);
    expect(doc.paths['/api/v1/extension/watches'].put.security).toEqual([
      { extensionCredential: [] },
    ]);
    expect(
      doc.paths['/api/v1/extension/watches/{watchId}'].delete.security,
    ).toEqual([{ extensionCredential: [] }]);
  });
});
