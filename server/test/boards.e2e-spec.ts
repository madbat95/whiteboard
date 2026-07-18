import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../src/auth/auth.module';
import { BoardsModule } from '../src/boards/boards.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

/** Minimal stateful in-memory stand-in for PrismaService, scoped to this test file. */
function createMockPrisma() {
  const boards = new Map<string, any>();
  const users = new Map<string, any>();
  let idCounter = 0;

  return {
    user: {
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const existing = users.get(where.id);
        const record = existing ? { ...existing, ...update } : { id: where.id, ...create };
        users.set(where.id, record);
        return record;
      }),
    },
    board: {
      create: jest.fn(async ({ data }: any) => {
        const id = `board-${++idCounter}`;
        const now = new Date();
        const record = { id, ...data, createdAt: now, updatedAt: now };
        boards.set(id, record);
        return record;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        return [...boards.values()].filter((b) => b.ownerId === where.ownerId);
      }),
      findUnique: jest.fn(async ({ where }: any) => boards.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = boards.get(where.id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, objects: data.objects, updatedAt: new Date() };
        boards.set(where.id, updated);
        return updated;
      }),
      delete: jest.fn(async ({ where }: any) => {
        boards.delete(where.id);
        return {};
      }),
    },
  };
}

describe('Boards REST API (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  const tokenFor = (sub: string, extra: Record<string, unknown> = {}) =>
    jwtService.sign({ sub, email: `${sub}@example.com`, name: sub, ...extra });

  beforeAll(async () => {
    mockPrisma = createMockPrisma();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, BoardsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    jwtService = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects requests with no Authorization header', async () => {
    await request(app.getHttpServer()).get('/api/boards').expect(401);
  });

  it('rejects requests with an invalid token', async () => {
    await request(app.getHttpServer())
      .get('/api/boards')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('creates a board for the authenticated user (POST /api/boards)', async () => {
    const token = tokenFor('owner-1');
    const res = await request(app.getHttpServer())
      .post('/api/boards')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'My Board' })
      .expect(201);

    expect(res.body).toMatchObject({ name: 'My Board', ownerId: 'owner-1' });
    expect(typeof res.body.roomId).toBe('string');
    expect(typeof res.body.createdAt).toBe('string');
  });

  it('lists only boards owned by the requesting user (GET /api/boards)', async () => {
    const ownerToken = tokenFor('owner-2');
    const otherToken = tokenFor('owner-3');

    await request(app.getHttpServer())
      .post('/api/boards')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Owner 2 Board' })
      .expect(201);

    const ownerList = await request(app.getHttpServer())
      .get('/api/boards')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(ownerList.body.boards).toHaveLength(1);
    expect(ownerList.body.boards[0]).toMatchObject({ name: 'Owner 2 Board' });

    const otherList = await request(app.getHttpServer())
      .get('/api/boards')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(otherList.body.boards).toHaveLength(0);
  });

  it('gets a board by roomId (GET /api/boards/:roomId)', async () => {
    const token = tokenFor('owner-4');
    const created = await request(app.getHttpServer())
      .post('/api/boards')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Fetchable' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/boards/${created.body.roomId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({
      roomId: created.body.roomId,
      name: 'Fetchable',
      ownerId: 'owner-4',
      objects: [],
    });
  });

  it('404s for a nonexistent board', async () => {
    const token = tokenFor('owner-5');
    await request(app.getHttpServer())
      .get('/api/boards/does-not-exist')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('checkpoints a snapshot via PATCH /api/boards/:roomId', async () => {
    const token = tokenFor('owner-6');
    const created = await request(app.getHttpServer())
      .post('/api/boards')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Patchable' })
      .expect(201);

    const objects = [
      { id: 'obj-1', type: 'text', x: 1, y: 2, content: 'hi', fontSize: 14, color: '#000' },
    ];

    const res = await request(app.getHttpServer())
      .patch(`/api/boards/${created.body.roomId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ objects })
      .expect(200);

    expect(res.body).toMatchObject({ roomId: created.body.roomId });

    const fetched = await request(app.getHttpServer())
      .get(`/api/boards/${created.body.roomId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(fetched.body.objects).toEqual(objects);
  });

  it('deletes a board only for its owner (DELETE /api/boards/:roomId)', async () => {
    const ownerToken = tokenFor('owner-7');
    const intruderToken = tokenFor('owner-8');
    const created = await request(app.getHttpServer())
      .post('/api/boards')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Deletable' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/boards/${created.body.roomId}`)
      .set('Authorization', `Bearer ${intruderToken}`)
      .expect(403);

    const res = await request(app.getHttpServer())
      .delete(`/api/boards/${created.body.roomId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body).toEqual({ roomId: created.body.roomId, deleted: true });
  });
});
