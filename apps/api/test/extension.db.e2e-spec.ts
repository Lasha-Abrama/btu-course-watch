import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import type { CourseObservation } from '@btu-course-watch/contracts';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import { SessionService } from '../src/auth/session.service.js';
import { ExtensionAuthService } from '../src/extension/extension-auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const testUrl = process.env.OBSERVATION_TEST_DATABASE_URL;
const available =
  testUrl && new URL(testUrl).pathname === '/btu_course_watch_phase5a_test';
const extensionId = 'a'.repeat(32);
const verifier = 'A'.repeat(43);
const challengeHash = createHash('sha256').update(verifier).digest('hex');
const access = 'W'.repeat(43);

describe.skipIf(!available)(
  'Extension authorization with PostgreSQL (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaClient;
    let authorizations: ExtensionAuthService;
    let userId: string;
    const courses = new Set<string>();
    const h = () => ({
      'X-BCW-Extension-Id': extensionId,
      Origin: `chrome-extension://${extensionId}`,
    });
    const web = () => ({
      Cookie: `bcw_access=${access}`,
      Origin: 'http://localhost:3000',
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
            if (token !== access)
              throw new UnauthorizedException('Authentication required');
            return {
              id: userId,
              email: 'test@btu.edu.ge',
              emailVerifiedAt: new Date(),
            };
          },
        })
        .compile();
      app = module.createNestApplication();
      configureApplication(app, app.get(ConfigService));
      await app.listen(0, '127.0.0.1');
      authorizations = app.get(ExtensionAuthService);
    });
    beforeEach(async () => {
      userId = randomUUID();
      await prisma.user.create({
        data: {
          id: userId,
          email: `${userId}@btu.edu.ge`,
          emailVerifiedAt: new Date(),
        },
      });
    });
    afterEach(async () => {
      await prisma.course.deleteMany({
        where: { btuCourseId: { in: [...courses] } },
      });
      courses.clear();
      await prisma.user.delete({ where: { id: userId } });
      await prisma.extensionLinkRequest.deleteMany({
        where: { approvedByUserId: null },
      });
    });
    afterAll(async () => {
      await app.close();
      await prisma.$disconnect();
    });

    async function start() {
      const installationId = randomUUID();
      const response = await request(app.getHttpServer())
        .post('/api/v1/extension/link-requests')
        .set(h())
        .send({ installationId, challengeHash })
        .expect(201);
      return { requestId: response.body.requestId as string, installationId };
    }

    async function approve(requestId: string) {
      await request(app.getHttpServer())
        .post(`/api/v1/extension/link-requests/${requestId}/approve`)
        .set(web())
        .send({})
        .expect(204);
    }

    it('requires web approval, binds exchange to verifier and extension, and never stores the raw credential', async () => {
      const { requestId } = await start();
      await request(app.getHttpServer())
        .post(`/api/v1/extension/link-requests/${requestId}/approve`)
        .set({ Cookie: `bcw_access=${access}`, Origin: 'https://evil.example' })
        .send({})
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/v1/extension/link-requests/${requestId}/approve`)
        .send({})
        .expect(401);
      await request(app.getHttpServer())
        .post(`/api/v1/extension/link-requests/${requestId}/exchange`)
        .set(h())
        .send({ verifier })
        .expect(200, { state: 'PENDING' });
      const info = await request(app.getHttpServer())
        .get(`/api/v1/extension/link-requests/${requestId}`)
        .set(web())
        .expect(200);
      expect(info.body.pairingCode).toBe(requestId.slice(-6).toUpperCase());
      expect(JSON.stringify(info.body)).not.toMatch(/challengeHash|verifier/);
      await approve(requestId);
      await request(app.getHttpServer())
        .post(`/api/v1/extension/link-requests/${requestId}/exchange`)
        .set({
          ...h(),
          'X-BCW-Extension-Id': 'b'.repeat(32),
          Origin: `chrome-extension://${'b'.repeat(32)}`,
        })
        .send({ verifier })
        .expect(401);
      await request(app.getHttpServer())
        .post(`/api/v1/extension/link-requests/${requestId}/exchange`)
        .set(h())
        .send({ verifier: 'B'.repeat(43) })
        .expect(401);
      const exchanged = await request(app.getHttpServer())
        .post(`/api/v1/extension/link-requests/${requestId}/exchange`)
        .set(h())
        .send({ verifier })
        .expect(200);
      const credential = exchanged.body.credential as string;
      expect(credential).toMatch(/^bcwx_[A-Za-z0-9_-]{43}$/);
      const record =
        await prisma.extensionObservationCredential.findFirstOrThrow({
          where: { userId },
        });
      await authorizations.revoke(randomUUID(), record.id);
      expect(
        (
          await prisma.extensionObservationCredential.findUniqueOrThrow({
            where: { id: record.id },
          })
        ).revokedAt,
      ).toBeNull();
      expect(record.tokenHash).toBe(
        createHash('sha256').update(credential).digest('hex'),
      );
      expect(JSON.stringify(record)).not.toContain(credential);
      await request(app.getHttpServer())
        .post(`/api/v1/extension/link-requests/${requestId}/exchange`)
        .set(h())
        .send({ verifier })
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/extension/status')
        .set({ ...h(), Authorization: `Bearer ${credential}` })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set({ Authorization: `Bearer ${credential}` })
        .expect(401);
    });

    it('rejects expired requests and credentials and revokes immediately', async () => {
      const expired = await start();
      await prisma.extensionLinkRequest.update({
        where: { id: expired.requestId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/extension/link-requests/${expired.requestId}/approve`)
        .set(web())
        .send({})
        .expect(400);
      const { requestId } = await start();
      await approve(requestId);
      const exchanged = await request(app.getHttpServer())
        .post(`/api/v1/extension/link-requests/${requestId}/exchange`)
        .set(h())
        .send({ verifier })
        .expect(200);
      const credential = exchanged.body.credential as string;
      const record =
        await prisma.extensionObservationCredential.findFirstOrThrow({
          where: { userId },
        });
      await request(app.getHttpServer())
        .get('/api/v1/extension/authorizations')
        .set(web())
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/extension/authorizations/${record.id}/revoke`)
        .set(web())
        .send({})
        .expect(204);
      await request(app.getHttpServer())
        .get('/api/v1/extension/status')
        .set({ ...h(), Authorization: `Bearer ${credential}` })
        .expect(401);
      await prisma.extensionObservationCredential.update({
        where: { id: record.id },
        data: { revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
      });
      await request(app.getHttpServer())
        .get('/api/v1/extension/status')
        .set({ ...h(), Authorization: `Bearer ${credential}` })
        .expect(401);
    });

    it('routes only structured observations to the existing idempotent state engine', async () => {
      const { requestId } = await start();
      await approve(requestId);
      const { body } = await request(app.getHttpServer())
        .post(`/api/v1/extension/link-requests/${requestId}/exchange`)
        .set(h())
        .send({ verifier })
        .expect(200);
      const credential = body.credential as string;
      const btuCourseId = `test_${randomUUID().replaceAll('-', '')}`;
      courses.add(btuCourseId);
      const payload: CourseObservation = {
        btuCourseId,
        observedAt: new Date().toISOString(),
        courseName: null,
        groups: [
          {
            btuGroupId: 'group-1',
            name: 'ჯგუფი 1',
            capacity: 27,
            status: 'FULL',
            chooseUrl: null,
          },
        ],
      };
      const submit = () =>
        request(app.getHttpServer())
          .post('/api/v1/extension/observations')
          .set({ ...h(), Authorization: `Bearer ${credential}` })
          .send(payload);
      const first = await submit().expect(201);
      expect(first.body).toMatchObject({
        groupsCreated: 1,
        discoveryEventsCreated: 1,
      });
      const second = await submit().expect(201);
      expect(second.body).toMatchObject({
        groupsSkipped: 1,
        statusChangesCreated: 0,
      });
      expect(
        await prisma.groupStateChange.count({
          where: { group: { course: { btuCourseId } } },
        }),
      ).toBe(1);
      await request(app.getHttpServer())
        .get(`/api/v1/courses/${btuCourseId}`)
        .set(web())
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/extension/observations')
        .set({ ...h(), Cookie: `bcw_access=${access}` })
        .send(payload)
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/observations')
        .set({ ...h(), Authorization: `Bearer ${credential}` })
        .send(payload)
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/extension/observations')
        .set(h())
        .send(payload)
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/extension/observations')
        .set({
          ...h(),
          Origin: 'https://evil.example',
          Authorization: `Bearer ${credential}`,
        })
        .send(payload)
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/extension/observations')
        .set({ ...h(), Authorization: `Bearer ${credential}` })
        .send({ ...payload, rawHtml: '<html>private</html>' })
        .expect(400);
      expect(
        await prisma.groupStateChange.count({
          where: { group: { course: { btuCourseId } } },
        }),
      ).toBe(1);
    });

    it('rejects unexpected redirect-like fields and invalid credential syntax', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/extension/link-requests')
        .set(h())
        .send({
          installationId: randomUUID(),
          challengeHash,
          redirectUrl: 'https://evil.example',
        })
        .expect(400);
      await request(app.getHttpServer())
        .get('/api/v1/extension/status')
        .set({ ...h(), Authorization: 'Bearer bad' })
        .expect(401);
      await expect(
        authorizations.authenticate(undefined, extensionId),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      const docs = await request(app.getHttpServer())
        .get('/api/docs/openapi.json')
        .expect(200);
      expect(
        docs.body.paths['/api/v1/extension/observations'].post.security,
      ).toEqual([{ extensionCredential: [] }]);
      expect(
        docs.body.paths['/api/v1/extension/observations'].post.requestBody,
      ).toEqual(docs.body.paths['/api/v1/observations'].post.requestBody);
      expect(
        docs.body.paths['/api/v1/extension/link-requests/{requestId}/approve']
          .post.security,
      ).toEqual([{ accessCookie: [] }]);
    });

    it('relinking the same installation revokes its old credential and bounds one active authorization', async () => {
      const installationId = randomUUID();
      const issue = async () => {
        const started = await request(app.getHttpServer())
          .post('/api/v1/extension/link-requests')
          .set(h())
          .send({ installationId, challengeHash })
          .expect(201);
        await approve(started.body.requestId as string);
        const exchanged = await request(app.getHttpServer())
          .post(
            `/api/v1/extension/link-requests/${started.body.requestId as string}/exchange`,
          )
          .set(h())
          .send({ verifier })
          .expect(200);
        return exchanged.body.credential as string;
      };
      const old = await issue();
      const current = await issue();
      expect(old).not.toBe(current);
      const credentials = await prisma.extensionObservationCredential.findMany({
        where: { installationId },
      });
      expect(credentials).toHaveLength(2);
      expect(
        credentials.filter((item) => item.revokedAt === null),
      ).toHaveLength(1);
      await request(app.getHttpServer())
        .get('/api/v1/extension/status')
        .set({ ...h(), Authorization: `Bearer ${old}` })
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/extension/status')
        .set({ ...h(), Authorization: `Bearer ${current}` })
        .expect(200);
    });
  },
);
