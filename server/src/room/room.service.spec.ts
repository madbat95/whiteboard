import { RoomService } from './room.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { BoardObject } from '../../../shared/contract';

describe('RoomService', () => {
  let prisma: { board: Record<string, jest.Mock> };
  let redis: Record<string, jest.Mock>;
  let service: RoomService;

  const rect: BoardObject = {
    id: 'obj-1',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: '#000',
    fillColor: null,
    strokeWidth: 2,
  };

  beforeEach(() => {
    prisma = {
      board: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    redis = {
      nextSeq: jest.fn().mockResolvedValue(1),
      getSeq: jest.fn().mockResolvedValue(0),
      setPresence: jest.fn().mockResolvedValue(undefined),
      refreshPresence: jest.fn().mockResolvedValue(undefined),
      removePresence: jest.fn().mockResolvedValue(undefined),
      getRoomPresence: jest.fn().mockResolvedValue([]),
      getRoomMemberCount: jest.fn().mockResolvedValue(0),
    };

    service = new RoomService(prisma as unknown as PrismaService, redis as unknown as RedisService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('object state', () => {
    it('loads persisted objects on first access', async () => {
      prisma.board.findUnique.mockResolvedValue({ objects: [rect] });
      await service.ensureLoaded('room-1');
      expect(service.getObjects('room-1')).toEqual([rect]);
    });

    it('applyCreate adds a new object and preserves insertion order', () => {
      service.applyCreate('room-1', rect);
      const second: BoardObject = { ...rect, id: 'obj-2' };
      service.applyCreate('room-1', second);
      expect(service.getObjects('room-1').map((o) => o.id)).toEqual(['obj-1', 'obj-2']);
    });

    it('applyUpdate merges a patch into the existing object', () => {
      service.applyCreate('room-1', rect);
      service.applyUpdate('room-1', { id: 'obj-1', x: 99 });
      expect(service.getObjects('room-1')[0]).toMatchObject({ id: 'obj-1', x: 99, y: 0 });
    });

    it('applyUpdate is a no-op for an unknown object id', () => {
      service.applyUpdate('room-1', { id: 'nope', x: 1 });
      expect(service.getObjects('room-1')).toEqual([]);
    });

    it('applyDelete removes the object', () => {
      service.applyCreate('room-1', rect);
      service.applyDelete('room-1', 'obj-1');
      expect(service.getObjects('room-1')).toEqual([]);
    });

    it('applyHistoryOp dispatches create/update/delete correctly', () => {
      service.applyHistoryOp('room-1', { kind: 'create', object: rect });
      expect(service.getObjects('room-1')).toEqual([rect]);

      service.applyHistoryOp('room-1', {
        kind: 'update',
        patch: { id: 'obj-1', x: 5 },
        previous: { id: 'obj-1', x: 0 },
      });
      expect(service.getObjects('room-1')[0]).toMatchObject({ x: 5 });

      service.applyHistoryOp('room-1', { kind: 'delete', objectId: 'obj-1', object: rect });
      expect(service.getObjects('room-1')).toEqual([]);
    });
  });

  describe('membership / presence', () => {
    it('assigns the first unused color on join', async () => {
      redis.getRoomPresence.mockResolvedValue([]);
      const summary = await service.join('room-1', 'socket-1', { id: 'u1', name: 'Alice', avatarUrl: null });
      expect(summary.color).toBe('#F94144');
      expect(redis.setPresence).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({ userId: 'u1', color: '#F94144' }),
      );
    });

    it('skips colors already in use in the room', async () => {
      redis.getRoomPresence.mockResolvedValue([
        { userId: 'other', name: 'Bob', avatarUrl: null, color: '#F94144' },
      ]);
      const summary = await service.join('room-1', 'socket-1', { id: 'u1', name: 'Alice', avatarUrl: null });
      expect(summary.color).toBe('#F3722C');
    });

    it('leaveSocket returns false while other sockets for the same user remain', async () => {
      await service.join('room-1', 'socket-1', { id: 'u1', name: 'Alice', avatarUrl: null });
      await service.join('room-1', 'socket-2', { id: 'u1', name: 'Alice', avatarUrl: null });
      const fullyLeft = await service.leaveSocket('room-1', 'socket-1', 'u1');
      expect(fullyLeft).toBe(false);
      expect(redis.removePresence).not.toHaveBeenCalled();
    });

    it('leaveSocket checkpoints and evicts the room once it goes empty', async () => {
      prisma.board.findUnique.mockResolvedValue({ objects: [] });
      await service.ensureLoaded('room-1');
      service.applyCreate('room-1', rect);
      await service.join('room-1', 'socket-1', { id: 'u1', name: 'Alice', avatarUrl: null });
      redis.getRoomMemberCount.mockResolvedValue(0);

      const fullyLeft = await service.leaveSocket('room-1', 'socket-1', 'u1');

      expect(fullyLeft).toBe(true);
      expect(redis.removePresence).toHaveBeenCalledWith('room-1', 'u1');
      expect(prisma.board.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'room-1' },
          data: expect.objectContaining({ objects: [rect] }),
        }),
      );
      // Room content cache was evicted — a fresh read reloads (empty local state) rather than reusing stale data.
      expect(service.getObjects('room-1')).toEqual([]);
    });
  });

  describe('checkpoint', () => {
    it('persists current objects and clears the dirty flag', async () => {
      service.applyCreate('room-1', rect);
      await service.checkpoint('room-1');
      expect(prisma.board.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: {
          objects: [rect],
          snapshots: { create: { objects: [rect] } },
        },
      });
    });

    it('is a no-op for a room with no local state', async () => {
      await service.checkpoint('unknown-room');
      expect(prisma.board.update).not.toHaveBeenCalled();
    });
  });

  describe('seq', () => {
    it('delegates to redis for the authoritative counter', async () => {
      redis.nextSeq.mockResolvedValue(42);
      const seq = await service.nextSeq('room-1');
      expect(seq).toBe(42);
      expect(redis.nextSeq).toHaveBeenCalledWith('room-1');
    });
  });
});
