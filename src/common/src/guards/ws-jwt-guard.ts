import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { Socket } from 'socket.io';
import { CognitoUser } from '../../../modules/auth/type';
import { ConnectionGameSocket } from '../../../modules/game/types';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  tokenUse: 'access',
  clientId: process.env.COGNITO_CLIENT_ID!,
});

@Injectable()
export class WsJwtGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: ConnectionGameSocket = context.switchToWs().getClient<Socket>();

    const token = client.handshake.auth?.token as string;

    if (!token) throw new UnauthorizedException('Token missing');

    try {
      const payload: CognitoUser = await verifier.verify(token.replace('Bearer ', ''));
      client.data.userId = payload.username;
      return true;
    } catch {
      throw new WsException('Unauthorized');
    }
  }
}
