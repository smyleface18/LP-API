import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { CognitoUser } from '../../../modules/auth/type';
@Injectable()
export class WsAuthService {
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
}
