import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Claims expected on the shared HS256 JWT. Issued by NextAuth on the
 * frontend, verified here with the shared JWT_SECRET (contract.ts §4).
 * The contract does not pin an exact claim shape beyond "same JWT used
 * for WS auth and REST Authorization header" — we take the conventional
 * NextAuth/JWT fields (sub/email/name/picture) since nothing more
 * specific is documented.
 */
export interface JwtClaims {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  [key: string]: unknown;
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Verifies an HS256 JWT. Throws UnauthorizedException if invalid/expired. */
  verify(token: string): JwtClaims {
    try {
      return this.jwtService.verify<JwtClaims>(token);
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Ensures a local User row exists for these claims (lazy upsert, since
   * this backend does not own the signup flow) and returns it in the
   * shape the rest of the app works with.
   */
  async resolveUser(claims: JwtClaims): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.upsert({
      where: { id: claims.sub },
      update: {
        email: claims.email ?? undefined,
        name: claims.name ?? undefined,
        avatarUrl: claims.picture ?? undefined,
      },
      create: {
        id: claims.sub,
        email: claims.email ?? null,
        name: claims.name ?? claims.email ?? 'Anonymous',
        avatarUrl: claims.picture ?? null,
      },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name ?? 'Anonymous',
      avatarUrl: user.avatarUrl,
    };
  }

  /** Verify + resolve in one step; used by both the REST guard and the WS gateway. */
  async authenticate(token: string): Promise<AuthenticatedUser> {
    const claims = this.verify(token);
    return this.resolveUser(claims);
  }
}
