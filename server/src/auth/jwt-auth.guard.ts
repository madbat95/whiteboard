import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService, AuthenticatedUser } from './auth.service';

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

/** REST guard: expects `Authorization: Bearer <token>`. 401 on missing/invalid token. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    request.user = await this.authService.authenticate(token);
    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers['authorization'];
    if (!header || Array.isArray(header)) return null;
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return null;
    return token;
  }
}
