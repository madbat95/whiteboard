import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions, Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';

/**
 * Custom Socket.IO adapter (B7):
 *  - wires @socket.io/redis-adapter so events fan out across multiple
 *    gateway instances via Redis pub/sub
 *  - runs JWT auth as a socket.io middleware (`server.use`), which is the
 *    mechanism that produces the contract's documented "connect_error"
 *    built-in event on rejection (contract.ts §2 header: "Server
 *    verifies JWT on connection; rejects with error event
 *    'connect_error'... if invalid"). Doing this in `handleConnection`
 *    instead would only let us disconnect an already-connected socket,
 *    which fires a plain 'disconnect' on the client, not 'connect_error'.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
    private readonly authService: AuthService,
    private readonly corsOrigin: string,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const pubClient = new Redis(this.redisUrl);
    const subClient = pubClient.duplicate();
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        pubClient.once('ready', () => resolve());
        pubClient.once('error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        subClient.once('ready', () => resolve());
        subClient.once('error', reject);
      }),
    ]);
    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log('Socket.IO Redis adapter connected');
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigin, credentials: true },
    });

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    server.use((socket: Socket, next: (err?: Error) => void) => {
      void (async () => {
        try {
          const token = socket.handshake.auth?.token as string | undefined;
          if (!token) throw new Error('Missing auth token');
          const user = await this.authService.authenticate(token);
          (socket.data as { user?: unknown }).user = user;
          next();
        } catch {
          next(new Error('Unauthorized'));
        }
      })();
    });

    return server;
  }
}
