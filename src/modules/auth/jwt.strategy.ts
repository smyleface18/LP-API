import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import * as jwksRsa from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { CognitoUser } from './type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      issuer: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`,
      algorithms: ['RS256'],
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}/.well-known/jwks.json`,
      }),
    });
  }

  /**
   * La firma y el issuer solo prueban que el token lo emitió este user pool.
   * Además hay que exigir que sea un access token (no un ID token) y de este
   * app client: si no, sirve cualquier token de otra app del mismo pool.
   * Mismo criterio que WsAuthService (aws-jwt-verify) para el socket.
   */
  validate(payload: CognitoUser): CognitoUser {
    if (payload.token_use !== 'access' || payload.client_id !== process.env.COGNITO_CLIENT_ID) {
      throw new UnauthorizedException('Invalid token');
    }
    return payload;
  }
}
