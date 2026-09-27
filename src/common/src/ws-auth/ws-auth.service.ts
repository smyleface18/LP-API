import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { Socket } from 'socket.io';
import { CognitoUser } from '../../../modules/auth/type';

/** Datos que deja `authenticateSocket` en `client.data`. */
export interface AuthenticatedSocketData {
  userId: string;
  role: string[];
}

@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  private verifier = CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID!,
    tokenUse: 'access',
    clientId: process.env.COGNITO_CLIENT_ID!,
  });

  async verifyToken(token: string): Promise<CognitoUser> {
    if (!token) throw new UnauthorizedException('Token missing');

    try {
      return await this.verifier.verify(token.replace('Bearer ', ''));
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * Autentica un socket recién conectado con el token de `handshake.auth.token`.
   * Si es válido deja `userId` y `role` en `client.data` y devuelve el payload;
   * si no, emite `errorEvent` con `{ ok, status, message }`, desconecta el
   * socket y devuelve null. Pensado para `handleConnection` de los gateways.
   */
  async authenticateSocket(client: Socket, errorEvent = 'error'): Promise<CognitoUser | null> {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      this.reject(client, errorEvent, 'Token missing');
      return null;
    }

    try {
      const payload = await this.verifyToken(token);
      const data = client.data as AuthenticatedSocketData;
      data.userId = payload.username;
      data.role = payload['cognito:groups'] || [];
      return payload;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`socket auth failed: ${errorMessage}`);
      this.reject(client, errorEvent, 'Unauthorized');
      return null;
    }
  }

  private reject(client: Socket, errorEvent: string, message: string) {
    client.emit(errorEvent, { ok: false, status: 401, message });
    client.disconnect();
  }
}
