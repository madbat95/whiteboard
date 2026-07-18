import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService, PresenceEntry } from '../redis/redis.service';
// eslint-disable-next-line import/no-relative-parent-imports
import type { BoardObject, BoardObjectPatch, HistoryOp, ObjectId, RoomId, UserId, UserSummary } from '../../../shared/contract';

const CHECKPOINT_INTERVAL_MS = 30_000;

// Stable, readable cursor/avatar colors. Cycled if a room has more members
// than colors (extremely unlikely for a portfolio project).
const COLOR_PALETTE = [
  '#F94144', '#F3722C', '#F8961E', '#F9C74F', '#90BE6D',
  '#43AA8B', '#4D908E', '#577590', '#277DA1', '#9C6ADE',
];

interface LocalRoomState {
  roomId: RoomId;
  /** Ordered board content — order doubles as z-order for rendering. */
  objects: Map<ObjectId, BoardObject>;
  order: ObjectId[];
  /** userId -> set of local socket ids (this process only; a user may have multiple tabs). */
  sockets: Map<UserId, Set<string>>;
  dirtySinceCheckpoint: boolean;
  loaded: boolean;
}

/**
 * Per-room state and membership tracking (B6).
 *
 * Board *content* (objects) is cached in-memory per gateway process for
 * low-latency mutation, seeded from Postgres on first access and
 * checkpointed back on a timer / manual save / room-empty (B11).
 *
 * Presence/roster (*who* is in the room, their assigned color) is *not*
 * kept authoritative here — it lives in Redis (RedisService) with a TTL,
 * per the intended scale-out story: any gateway instance behind the
 * Redis pub/sub adapter can answer "who's in this room" without owning
 * process-local state. The `sockets` map here is only a local index used
 * to detect "this was the last socket for this user on this process" and
 * to decide when a room has gone fully empty.
 */
@Injectable()
export class RoomService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomService.name);
  private readonly rooms = new Map<RoomId, LocalRoomState>();
  private checkpointTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    this.checkpointTimer = setInterval(() => {
      void this.runScheduledCheckpoints();
    }, CHECKPOINT_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.checkpointTimer) clearInterval(this.checkpointTimer);
  }

  // ---------------------------------------------------------------------
  // Room content (whiteboard objects)
  // ---------------------------------------------------------------------

  private getOrCreateLocal(roomId: RoomId): LocalRoomState {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { roomId, objects: new Map(), order: [], sockets: new Map(), dirtySinceCheckpoint: false, loaded: false };
      this.rooms.set(roomId, room);
    }
    return room;
  }

  /** Loads a board's latest persisted objects into memory, if not already loaded. */
  async ensureLoaded(roomId: RoomId): Promise<LocalRoomState> {
    const room = this.getOrCreateLocal(roomId);
    if (room.loaded) return room;

    const board = await this.prisma.board.findUnique({ where: { id: roomId } });
    const objects = (board?.objects as unknown as BoardObject[] | null) ?? [];
    for (const obj of objects) {
      room.objects.set(obj.id, obj);
      room.order.push(obj.id);
    }
    room.loaded = true;
    return room;
  }

  getObjects(roomId: RoomId): BoardObject[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return room.order.map((id) => room.objects.get(id)).filter((o): o is BoardObject => !!o);
  }

  applyCreate(roomId: RoomId, object: BoardObject): void {
    const room = this.getOrCreateLocal(roomId);
    if (!room.objects.has(object.id)) room.order.push(object.id);
    room.objects.set(object.id, object);
    room.dirtySinceCheckpoint = true;
  }

  applyUpdate(roomId: RoomId, patch: BoardObjectPatch): void {
    const room = this.getOrCreateLocal(roomId);
    const existing = room.objects.get(patch.id);
    if (!existing) return; // unknown object — nothing to patch against
    room.objects.set(patch.id, { ...existing, ...patch } as BoardObject);
    room.dirtySinceCheckpoint = true;
  }

  applyDelete(roomId: RoomId, objectId: ObjectId): void {
    const room = this.getOrCreateLocal(roomId);
    if (room.objects.delete(objectId)) {
      room.order = room.order.filter((id) => id !== objectId);
      room.dirtySinceCheckpoint = true;
    }
  }

  /** Applies the inverse/forward op carried by history:undo / history:redo. */
  applyHistoryOp(roomId: RoomId, op: HistoryOp): void {
    switch (op.kind) {
      case 'create':
        this.applyCreate(roomId, op.object);
        break;
      case 'update':
        this.applyUpdate(roomId, op.patch);
        break;
      case 'delete':
        this.applyDelete(roomId, op.objectId);
        break;
    }
  }

  // ---------------------------------------------------------------------
  // Seq (delegated to Redis so it's authoritative across instances)
  // ---------------------------------------------------------------------

  async nextSeq(roomId: RoomId): Promise<number> {
    return this.redis.nextSeq(roomId);
  }

  async currentSeq(roomId: RoomId): Promise<number> {
    return this.redis.getSeq(roomId);
  }

  // ---------------------------------------------------------------------
  // Membership / presence
  // ---------------------------------------------------------------------

  /** Registers a socket for a user in a room; assigns a color on first join. Returns the user's roster entry. */
  async join(roomId: RoomId, socketId: string, user: { id: UserId; name: string; avatarUrl: string | null }): Promise<UserSummary> {
    const room = this.getOrCreateLocal(roomId);
    const sockets = room.sockets.get(user.id) ?? new Set<string>();
    sockets.add(socketId);
    room.sockets.set(user.id, sockets);

    const existing = await this.redis.getRoomPresence(roomId);
    const existingEntry = existing.find((e) => e.userId === user.id);
    const color = existingEntry?.color ?? this.assignColor(existing);

    const entry: PresenceEntry = { userId: user.id, name: user.name, avatarUrl: user.avatarUrl, color };
    await this.redis.setPresence(roomId, entry);

    return { id: user.id, name: user.name, avatarUrl: user.avatarUrl, color };
  }

  /** Unregisters a socket. Returns whether the user has no more sockets in this room (i.e. fully left). */
  async leaveSocket(roomId: RoomId, socketId: string, userId: UserId): Promise<boolean> {
    const room = this.rooms.get(roomId);
    const sockets = room?.sockets.get(userId);
    sockets?.delete(socketId);
    const fullyLeft = !sockets || sockets.size === 0;
    if (fullyLeft) {
      room?.sockets.delete(userId);
      await this.redis.removePresence(roomId, userId);
      const remaining = await this.redis.getRoomMemberCount(roomId);
      if (remaining === 0) {
        await this.checkpoint(roomId);
        this.rooms.delete(roomId); // free in-memory content cache; reloaded lazily on next join
      }
    }
    return fullyLeft;
  }

  async refreshPresence(roomId: RoomId, userId: UserId): Promise<void> {
    await this.redis.refreshPresence(roomId, userId);
  }

  async getRoster(roomId: RoomId): Promise<UserSummary[]> {
    const entries = await this.redis.getRoomPresence(roomId);
    return entries.map((e) => ({ id: e.userId, name: e.name, avatarUrl: e.avatarUrl, color: e.color }));
  }

  private assignColor(existing: PresenceEntry[]): string {
    const used = new Set(existing.map((e) => e.color));
    const free = COLOR_PALETTE.find((c) => !used.has(c));
    if (free) return free;
    return COLOR_PALETTE[existing.length % COLOR_PALETTE.length];
  }

  // ---------------------------------------------------------------------
  // Checkpointing (B11)
  // ---------------------------------------------------------------------

  markDirty(roomId: RoomId): void {
    this.getOrCreateLocal(roomId).dirtySinceCheckpoint = true;
  }

  /** Persists the in-memory object list for a room into Board.objects + a BoardSnapshot row. */
  async checkpoint(roomId: RoomId): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const objects = this.getObjects(roomId);
    await this.prisma.board.update({
      where: { id: roomId },
      data: {
        objects: objects as unknown as object,
        snapshots: { create: { objects: objects as unknown as object } },
      },
    });
    room.dirtySinceCheckpoint = false;
  }

  private async runScheduledCheckpoints(): Promise<void> {
    for (const [roomId, room] of this.rooms) {
      if (!room.dirtySinceCheckpoint) continue;
      try {
        await this.checkpoint(roomId);
      } catch (err) {
        this.logger.error(`Scheduled checkpoint failed for room ${roomId}`, err as Error);
      }
    }
  }
}
