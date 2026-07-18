import { BoardGateway } from './board.gateway';
import { RoomService } from '../room/room.service';
import { PrismaService } from '../prisma/prisma.service';
import type { BoardObject } from '../../../shared/contract';

function makeSocket(userId: string) {
  return {
    id: `socket-${userId}`,
    data: { user: { id: userId, name: `User ${userId}`, avatarUrl: null }, rooms: new Set<string>() },
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
  } as any;
}

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

describe('BoardGateway', () => {
  let roomService: Record<string, jest.Mock>;
  let prisma: { board: Record<string, jest.Mock> };
  let gateway: BoardGateway;

  beforeEach(() => {
    roomService = {
      ensureLoaded: jest.fn().mockResolvedValue(undefined),
      join: jest.fn().mockResolvedValue({ id: 'u1', name: 'User u1', avatarUrl: null, color: '#F94144' }),
      leaveSocket: jest.fn().mockResolvedValue(true),
      refreshPresence: jest.fn().mockResolvedValue(undefined),
      getObjects: jest.fn().mockReturnValue([]),
      getRoster: jest.fn().mockResolvedValue([{ id: 'u1', name: 'User u1', avatarUrl: null, color: '#F94144' }]),
      currentSeq: jest.fn().mockResolvedValue(0),
      nextSeq: jest.fn().mockResolvedValue(1),
      applyCreate: jest.fn(),
      applyUpdate: jest.fn(),
      applyDelete: jest.fn(),
      applyHistoryOp: jest.fn(),
      markDirty: jest.fn(),
    };
    prisma = { board: { findUnique: jest.fn().mockResolvedValue({ id: 'room-1' }) } };
    gateway = new BoardGateway(roomService as unknown as RoomService, prisma as unknown as PrismaService);
  });

  describe('room:join', () => {
    it('emits room:state to the joining socket and presence:join to the rest of the room', async () => {
      const socket = makeSocket('u1');
      await gateway.handleJoin(socket, { roomId: 'room-1' });

      expect(socket.join).toHaveBeenCalledWith('room-1');
      expect(socket.data.rooms.has('room-1')).toBe(true);
      expect(socket.emit).toHaveBeenCalledWith('room:state', {
        roomId: 'room-1',
        objects: [],
        users: [{ id: 'u1', name: 'User u1', avatarUrl: null, color: '#F94144' }],
        lastSeq: 0,
      });
      expect(socket.to).toHaveBeenCalledWith('room-1');
      expect(socket.emit).toHaveBeenCalledWith('presence:join', {
        roomId: 'room-1',
        user: { id: 'u1', name: 'User u1', avatarUrl: null, color: '#F94144' },
      });
    });

    it('emits room:error and does not join when the board does not exist', async () => {
      prisma.board.findUnique.mockResolvedValue(null);
      const socket = makeSocket('u1');
      await gateway.handleJoin(socket, { roomId: 'missing' });

      expect(socket.emit).toHaveBeenCalledWith('room:error', { roomId: 'missing', message: 'Board not found' });
      expect(socket.join).not.toHaveBeenCalled();
      expect(roomService.join).not.toHaveBeenCalled();
    });
  });

  describe('object:create', () => {
    it('assigns a server seq (ignoring the client-sent seq) and rebroadcasts to the rest of the room only', async () => {
      const socket = makeSocket('u1');
      socket.data.rooms.add('room-1');
      roomService.nextSeq.mockResolvedValue(7);

      await gateway.handleObjectCreate(socket, { roomId: 'room-1', object: rect, seq: 999 });

      expect(roomService.applyCreate).toHaveBeenCalledWith('room-1', rect);
      expect(socket.to).toHaveBeenCalledWith('room-1');
      expect(socket.emit).toHaveBeenCalledWith('object:created', { roomId: 'room-1', object: rect, seq: 7 });
      // Never the client-supplied seq (999) — server is sole assigner per contract §4.
      expect(socket.emit).not.toHaveBeenCalledWith('object:created', expect.objectContaining({ seq: 999 }));
    });

    it('rejects with room:error when the sender has not joined the room', async () => {
      const socket = makeSocket('u1'); // rooms is empty
      await gateway.handleObjectCreate(socket, { roomId: 'room-1', object: rect, seq: 1 });

      expect(roomService.applyCreate).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('room:error', {
        roomId: 'room-1',
        message: 'You have not joined this room',
      });
    });
  });

  describe('object:update', () => {
    it('requests a resync instead of applying a patch for an unknown object id', async () => {
      const socket = makeSocket('u1');
      socket.data.rooms.add('room-1');
      roomService.getObjects.mockReturnValue([]); // server has no objects — patch target is unknown

      await gateway.handleObjectUpdate(socket, { roomId: 'room-1', patch: { id: 'obj-1', x: 1 }, seq: 1 });

      expect(roomService.applyUpdate).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('room:resync-required', { roomId: 'room-1' });
    });

    it('applies and rebroadcasts a patch for a known object', async () => {
      const socket = makeSocket('u1');
      socket.data.rooms.add('room-1');
      roomService.getObjects.mockReturnValue([rect]);
      roomService.nextSeq.mockResolvedValue(3);

      const patch = { id: 'obj-1', x: 42 };
      await gateway.handleObjectUpdate(socket, { roomId: 'room-1', patch, seq: 1 });

      expect(roomService.applyUpdate).toHaveBeenCalledWith('room-1', patch);
      expect(socket.emit).toHaveBeenCalledWith('object:updated', { roomId: 'room-1', patch, seq: 3 });
    });
  });

  describe('history:undo / history:redo', () => {
    it('applies the inverse op and emits history:undone with a server seq', async () => {
      const socket = makeSocket('u1');
      socket.data.rooms.add('room-1');
      roomService.nextSeq.mockResolvedValue(5);
      const inverseOp = { kind: 'delete' as const, objectId: 'obj-1', object: rect };

      await gateway.handleUndo(socket, { roomId: 'room-1', inverseOp, seq: 1 });

      expect(roomService.applyHistoryOp).toHaveBeenCalledWith('room-1', inverseOp);
      expect(socket.emit).toHaveBeenCalledWith('history:undone', { roomId: 'room-1', inverseOp, seq: 5 });
    });
  });

  describe('disconnect', () => {
    it('leaves every room the socket had joined and announces presence:leave for fully-left rooms', async () => {
      const socket = makeSocket('u1');
      socket.data.rooms = new Set(['room-1', 'room-2']);
      roomService.leaveSocket.mockResolvedValue(true);

      await gateway.handleDisconnect(socket);

      expect(roomService.leaveSocket).toHaveBeenCalledWith('room-1', socket.id, 'u1');
      expect(roomService.leaveSocket).toHaveBeenCalledWith('room-2', socket.id, 'u1');
      expect(socket.emit).toHaveBeenCalledWith('presence:leave', { roomId: 'room-1', userId: 'u1' });
      expect(socket.emit).toHaveBeenCalledWith('presence:leave', { roomId: 'room-2', userId: 'u1' });
    });
  });
});
