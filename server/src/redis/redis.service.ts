import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface PresenceEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: string;
}

const PRESENCE_TTL_SECONDS = 90; // refreshed on cursor:move / heartbeat; well above expected idle gaps

/**
 * Wraps ioredis. Owns:
 *  - the pub/sub client pair handed to @socket.io/redis-adapter (B7)
 *  - per-room presence state with TTL (B8) so roster survives across
 *    instances instead of living only in gateway process memory
 *  - the authoritative per-room `seq` counter (B9), via atomic INCR so it
 *    stays monotonic even with multiple gateway instances behind Redis pub/sub
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  readonly client: Redis;
  readonly pubClient: Redis;
  readonly subClient: Redis;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.client = new Redis(url, { lazyConnect: true });
    this.pubClient = new Redis(url, { lazyConnect: true });
    this.subClient = this.pubClient.duplicate();
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([this.client.connect(), this.pubClient.connect(), this.subClient.connect()]);
    this.logger.log('Connected to Redis');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.client.quit(), this.pubClient.quit(), this.subClient.quit()]);
  }

  // ---------------------------------------------------------------------
  // Presence (contract §2 presence:join/leave, cursor:update backing store)
  // ---------------------------------------------------------------------

  private presenceKey(roomId: string, userId: string): string {
    return `presence:${roomId}:${userId}`;
  }

  private membersKey(roomId: string): string {
    return `room:${roomId}:members`;
  }

  async setPresence(roomId: string, entry: PresenceEntry): Promise<void> {
    await Promise.all([
      this.client.set(this.presenceKey(roomId, entry.userId), JSON.stringify(entry), 'EX', PRESENCE_TTL_SECONDS),
      this.client.sadd(this.membersKey(roomId), entry.userId),
    ]);
  }

  async refreshPresence(roomId: string, userId: string): Promise<void> {
    await this.client.expire(this.presenceKey(roomId, userId), PRESENCE_TTL_SECONDS);
  }

  async removePresence(roomId: string, userId: string): Promise<void> {
    await Promise.all([
      this.client.del(this.presenceKey(roomId, userId)),
      this.client.srem(this.membersKey(roomId), userId),
    ]);
  }

  async getRoomPresence(roomId: string): Promise<PresenceEntry[]> {
    const userIds = await this.client.smembers(this.membersKey(roomId));
    if (userIds.length === 0) return [];
    const keys = userIds.map((id) => this.presenceKey(roomId, id));
    const raw = await this.client.mget(...keys);
    const entries: PresenceEntry[] = [];
    for (let i = 0; i < raw.length; i++) {
      const value = raw[i];
      if (!value) {
        // TTL expired but the set entry lingered — clean it up lazily.
        void this.client.srem(this.membersKey(roomId), userIds[i]);
        continue;
      }
      entries.push(JSON.parse(value) as PresenceEntry);
    }
    return entries;
  }

  async getRoomMemberCount(roomId: string): Promise<number> {
    return this.client.scard(this.membersKey(roomId));
  }

  // ---------------------------------------------------------------------
  // Authoritative per-room seq counter (contract §4: server-assigned, monotonic)
  // ---------------------------------------------------------------------

  private seqKey(roomId: string): string {
    return `room:${roomId}:seq`;
  }

  /** Atomically increments and returns the next seq for a room. */
  async nextSeq(roomId: string): Promise<number> {
    return this.client.incr(this.seqKey(roomId));
  }

  async getSeq(roomId: string): Promise<number> {
    const value = await this.client.get(this.seqKey(roomId));
    return value ? parseInt(value, 10) : 0;
  }

  async setSeq(roomId: string, seq: number): Promise<void> {
    await this.client.set(this.seqKey(roomId), seq);
  }
}
