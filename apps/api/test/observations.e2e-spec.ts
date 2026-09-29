import type { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { CourseObservation } from '@btu-course-watch/contracts';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import { SessionService } from '../src/auth/session.service.js';
import { ObservationsService } from '../src/observations/observations.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const ACCESS = 'A'.repeat(43);

function observation(): CourseObservation {
  return {
    btuCourseId: '665',
    observedAt: new Date().toISOString(),
    courseName: null,
    groups: [
      {
        btuGroupId: '13575',
        name: 'ჯგუფი 1.1',
        capacity: 27,
        status: 'FULL',
        chooseUrl: null,
      },
    ],
  };
}

describe('Observation HTTP boundary (e2e)', () => {
  let app: INestApplication;
  const ingest = vi.fn(async () => ({
    btuCourseId: '665',
    groupsCreated: 1,
    groupsUpdated: 0,
    groupsSkipped: 0,
    discoveryEventsCreated: 1,
    statusChangesCreated: 0,
  }));
  const courseState = vi.fn(async () => ({
    btuCourseId: '665',
    name: null,
    lastObservedAt: new Date().toISOString(),
    groups: [],
    recentChanges: [],
  }));

  beforeEach(async () => {
    ingest.mockClear();
    courseState.mockClear();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: async () => {}, $disconnect: async () => {} })
      .overrideProvider(SessionService)
      .useValue({
        authenticate: async (token: string | undefined) => {
          if (token !== ACCESS)
            throw new UnauthorizedException('Authentication required');
          return {
            id: 'user-id',
            email: 'student@btu.edu.ge',
            emailVerifiedAt: new Date(),
          };
        },
      })
      .overrideProvider(ObservationsService)
      .useValue({ ingest, courseState })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, app.get(ConfigService));
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => app.close());

  it('rejects unauthenticated ingestion and reads', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/observations')
      .send(observation())
      .expect(401);
    await request(app.getHttpServer()).get('/api/v1/courses/665').expect(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('accepts only a structured observation and returns sanitized counts', async () => {
    const payload = observation();
    const response = await request(app.getHttpServer())
      .post('/api/v1/observations')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', `bcw_access=${ACCESS}`)
      .send(payload)
      .expect(201);
    expect(ingest).toHaveBeenCalledWith(payload);
    expect(response.body).toEqual({
      btuCourseId: '665',
      groupsCreated: 1,
      groupsUpdated: 0,
      groupsSkipped: 0,
      discoveryEventsCreated: 1,
      statusChangesCreated: 0,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/student@|choose\//);
  });

  it('rejects untrusted browser origins without calling ingestion', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/observations')
      .set('Origin', 'https://evil.example')
      .set('Cookie', `bcw_access=${ACCESS}`)
      .send(observation())
      .expect(403);
    expect(ingest).not.toHaveBeenCalled();
  });

  it.each([
    { rawHtml: 'private' },
    { userId: 'forged-user' },
    { btuCourseId: ' 665 ' },
    { observedAt: '2026-02-30T00:00:00.000Z' },
    { observedAt: new Date(Date.now() + 10 * 60_000).toISOString() },
    { groups: [] },
    { groups: Array.from({ length: 101 }, () => observation().groups[0]) },
    { groups: [{ ...observation().groups[0], capacity: -1 }] },
    { groups: [{ ...observation().groups[0], status: 'AVAILABLE' }] },
    { groups: [{ ...observation().groups[0], btuGroupId: '../bad' }] },
    { groups: [{ ...observation().groups[0], cookie: 'sensitive' }] },
    {
      groups: [
        {
          ...observation().groups[0],
          chooseUrl: 'https://evil.example/ge/student/me/choose/1',
        },
      ],
    },
    { groups: [observation().groups[0], observation().groups[0]] },
  ])('rejects malformed or unexpected payload fields %#', async (change) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/observations')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', `bcw_access=${ACCESS}`)
      .send({ ...observation(), ...change })
      .expect(400);
    expect(response.body.message).toBe('Invalid structured observation');
    expect(JSON.stringify(response.body)).not.toMatch(
      /private|forged-user|evil\.example/,
    );
    expect(ingest).not.toHaveBeenCalled();
  });

  it('rejects oversized request bodies without echoing their contents', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/observations')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', `bcw_access=${ACCESS}`)
      .send({ ...observation(), rawHtml: 'secret-page'.repeat(9_100) })
      .expect(400);
    expect(JSON.stringify(response.body)).not.toContain('secret-page');
    expect(ingest).not.toHaveBeenCalled();
  });

  it('documents both authenticated routes in OpenAPI', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs/openapi.json')
      .expect(200);
    expect(response.body.paths['/api/v1/observations'].post.security).toEqual([
      { accessCookie: [] },
    ]);
    expect(
      response.body.paths['/api/v1/courses/{btuCourseId}'].get.security,
    ).toEqual([{ accessCookie: [] }]);
  });

  it('serves shared canonical state without user or Choose URLs', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/courses/665')
      .set('Cookie', `bcw_access=${ACCESS}`)
      .expect(200);
    expect(response.body.btuCourseId).toBe('665');
    expect(JSON.stringify(response.body)).not.toMatch(/student@|chooseUrl/);
    await request(app.getHttpServer())
      .get('/api/v1/courses/%2E%2E')
      .set('Cookie', `bcw_access=${ACCESS}`)
      .expect(400);
  });
});
