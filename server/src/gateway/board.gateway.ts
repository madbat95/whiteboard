import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomService } from '../room/room.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.service';
import type {
  BoardObject,
  BoardObjectPatch,
  HistoryOp,
  ObjectId,
  RoomId,
} from '../../../shared/contract';

interface SocketData {
  user: AuthenticatedUser;
  rooms: Set<RoomId>;
}

type AppSocket = Socket & { data: SocketData };

/**
 * BoardGateway (B5, B9, B10): the default "/" namespace, room isolation via
 * socket.io rooms keyed by RoomId, per contract §2. Auth happens in the
 * RedisIoAdapter's `server.use` middleware (see redis-io.adapter.ts) before
 * any of these handlers run, so `socket.data.user` is always populated here.
 */
@WebSocketGateway()
export class BoardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(BoardGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly roomService: RoomService,
    private readonly prisma: PrismaService,
  ) {}

  handleConnection(socket: AppSocket): void {
    socket.data.rooms = new Set();
    this.logger.debug(`Socket connected: ${socket.id} (user ${socket.data.user?.id})`);
  }

  async handleDisconnect(socket: AppSocket): Promise<void> {
    const rooms = socket.data.rooms ?? new Set<RoomId>();
    for (const roomId of rooms) {
      await this.leaveRoom(socket, roomId);
    }
  }

  // ---------------------------------------------------------------------
  // room:join / room:leave
  // ---------------------------------------------------------------------

  @SubscribeMessage('room:join')
  async handleJoin(socket: AppSocket, payload: { roomId: RoomId }): Promise<void> {
    const { roomId } = payload ?? {};
    if (!roomId) {
      socket.emit('room:error', { roomId: roomId ?? '', message: 'roomId is required' });
      return;
    }

    const board = await this.prisma.board.findUnique({ where: { id: roomId } });
    if (!board) {
      socket.emit('room:error', { roomId, message: 'Board not found' });
      return;
    }

    await this.roomService.ensureLoaded(roomId);
    await this.roomService.join(roomId, socket.id, {
      id: socket.data.user.id,
      name: socket.data.user.name,
      avatarUrl: socket.data.user.avatarUrl,
    });

    socket.join(roomId);
    socket.data.rooms.add(roomId);

    const [objects, users, lastSeq] = await Promise.all([
      Promise.resolve(this.roomService.getObjects(roomId)),
      this.roomService.getRoster(roomId),
      this.roomService.currentSeq(roomId),
    ]);

    socket.emit('room:state', { roomId, objects, users, lastSeq });

    const self = users.find((u) => u.id === socket.data.user.id);
    if (self) {
      socket.to(roomId).emit('presence:join', { roomId, user: self });
    }
  }

  @SubscribeMessage('room:leave')
  async handleLeave(socket: AppSocket, payload: { roomId: RoomId }): Promise<void> {
    const { roomId } = payload ?? {};
    if (!roomId) return;
    await this.leaveRoom(socket, roomId);
  }

  private async leaveRoom(socket: AppSocket, roomId: RoomId): Promise<void> {
    socket.leave(roomId);
    socket.data.rooms?.delete(roomId);
    const fullyLeft = await this.roomService.leaveSocket(roomId, socket.id, socket.data.user.id);
    if (fullyLeft) {
      socket.to(roomId).emit('presence:leave', { roomId, userId: socket.data.user.id });
    }
  }

  // ---------------------------------------------------------------------
  // cursor:move
  // ---------------------------------------------------------------------

  @SubscribeMessage('cursor:move')
  async handleCursorMove(
    socket: AppSocket,
    payload: { roomId: RoomId; x: number; y: number },
  ): Promise<void> {
    const { roomId, x, y } = payload ?? {};
    if (!roomId || !this.isMember(socket, roomId)) return;
    await this.roomService.refreshPresence(roomId, socket.data.user.id);
    // Rebroadcast only — never persisted, never echoed back to sender (contract §2).
    socket.to(roomId).emit('cursor:update', { roomId, userId: socket.data.user.id, x, y });
  }

  // ---------------------------------------------------------------------
  // object:create / object:update / object:delete
  // ---------------------------------------------------------------------

  @SubscribeMessage('object:create')
  async handleObjectCreate(
    socket: AppSocket,
    payload: { roomId: RoomId; object: BoardObject; seq: number },
  ): Promise<void> {
    const { roomId, object } = payload ?? {};
    if (!roomId || !object || !this.isMember(socket, roomId)) return;

    this.roomService.applyCreate(roomId, object);
    this.roomService.markDirty(roomId);
    const seq = await this.roomService.nextSeq(roomId);

    // Echoed to all clients in room except sender (contract §2).
    socket.to(roomId).emit('object:created', { roomId, object, seq });
  }

  @SubscribeMessage('object:update')
  async handleObjectUpdate(
    socket: AppSocket,
    payload: { roomId: RoomId; patch: BoardObjectPatch; seq: number },
  ): Promise<void> {
    const { roomId, patch } = payload ?? {};
    if (!roomId || !patch || !this.isMember(socket, roomId)) return;

    if (!this.objectExists(roomId, patch.id)) {
      // Client is patching an object the server doesn't have — it's
      // operating on stale state (missed a create/delete). Ask it to
      // resync rather than silently dropping or corrupting state.
      socket.emit('room:resync-required', { roomId });
      return;
    }

    this.roomService.applyUpdate(roomId, patch);
    this.roomService.markDirty(roomId);
    const seq = await this.roomService.nextSeq(roomId);

    socket.to(roomId).emit('object:updated', { roomId, patch, seq });
  }

  @SubscribeMessage('object:delete')
  async handleObjectDelete(
    socket: AppSocket,
    payload: { roomId: RoomId; objectId: ObjectId; seq: number },
  ): Promise<void> {
    const { roomId, objectId } = payload ?? {};
    if (!roomId || !objectId || !this.isMember(socket, roomId)) return;

    this.roomService.applyDelete(roomId, objectId);
    this.roomService.markDirty(roomId);
    const seq = await this.roomService.nextSeq(roomId);

    socket.to(roomId).emit('object:deleted', { roomId, objectId, seq });
  }

  // ---------------------------------------------------------------------
  // history:undo / history:redo
  // ---------------------------------------------------------------------

  @SubscribeMessage('history:undo')
  async handleUndo(
    socket: AppSocket,
    payload: { roomId: RoomId; inverseOp: HistoryOp; seq: number },
  ): Promise<void> {
    const { roomId, inverseOp } = payload ?? {};
    if (!roomId || !inverseOp || !this.isMember(socket, roomId)) return;

    this.roomService.applyHistoryOp(roomId, inverseOp);
    this.roomService.markDirty(roomId);
    const seq = await this.roomService.nextSeq(roomId);

    socket.to(roomId).emit('history:undone', { roomId, inverseOp, seq });
  }

  @SubscribeMessage('history:redo')
  async handleRedo(
    socket: AppSocket,
    payload: { roomId: RoomId; op: HistoryOp; seq: number },
  ): Promise<void> {
    const { roomId, op } = payload ?? {};
    if (!roomId || !op || !this.isMember(socket, roomId)) return;

    this.roomService.applyHistoryOp(roomId, op);
    this.roomService.markDirty(roomId);
    const seq = await this.roomService.nextSeq(roomId);

    socket.to(roomId).emit('history:redone', { roomId, op, seq });
  }

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------

  private isMember(socket: AppSocket, roomId: RoomId): boolean {
    const isMember = socket.data.rooms?.has(roomId);
    if (!isMember) {
      socket.emit('room:error', { roomId, message: 'You have not joined this room' });
    }
    return !!isMember;
  }

  private objectExists(roomId: RoomId, objectId: ObjectId): boolean {
    return this.roomService.getObjects(roomId).some((o) => o.id === objectId);
  }
}
