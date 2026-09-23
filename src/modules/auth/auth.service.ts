import {
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  ChangePasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RevokeTokenCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { SignUpDto } from './dto/signUp.dto';
import { v4 } from 'uuid';
import { SignInDto } from './dto/signIn.dto';
import { UserRoles } from '@/db/enum/roles.enum';
import { Repository } from 'typeorm';
import { User } from '@/db/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { EnvsService } from '@/common/src/envs/envs.service';
import { MediaService } from '../media/media.service';
import { toSafeAuthError } from './cognito-errors';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private cognitoClient: CognitoIdentityProviderClient;
  private clientId: string;

  constructor(
    private envsService: EnvsService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mediaService: MediaService,
  ) {
    const { region, cognitoClientId } = this.envsService.awsConfig;
    this.clientId = cognitoClientId;

    this.cognitoClient = new CognitoIdentityProviderClient({
      region,
    });
  }

  async signUp(signUpDto: SignUpDto) {
    const existingUser = await this.userRepository.findOne({
      where: { email: signUpDto.email },
    });
    if (existingUser) {
      throw new BadRequestException('Email already in use');
    }

    const usernameId = v4();
    let userSub: string | undefined;
    try {
      const response = await this.cognitoClient.send(
        new SignUpCommand({
          ClientId: this.clientId,
          Username: usernameId,
          Password: signUpDto.password,
          UserAttributes: [
            { Name: 'email', Value: signUpDto.email },
            { Name: 'nickname', Value: signUpDto.username },
          ],
        }),
      );
      userSub = response.UserSub;
    } catch (error) {
      throw toSafeAuthError(error, new BadRequestException('Could not register user'));
    }

    // Si falla algo después de crear el usuario en Cognito, se borra (acción
    // compensatoria): si no, queda un usuario en Cognito sin fila en la BD, que
    // puede iniciar sesión pero no jugar, y el email queda tomado.
    try {
      await this.cognitoClient.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: process.env.COGNITO_USER_POOL_ID,
          GroupName: UserRoles.PLAYER,
          Username: usernameId,
        }),
      );

      await this.userRepository.save(
        this.userRepository.create({
          id: usernameId,
          email: signUpDto.email,
          username: signUpDto.username,
        }),
      );
    } catch (error) {
      this.logger.error(`signUp failed after Cognito user creation: ${(error as Error).message}`);
      await this.cognitoClient
        .send(
          new AdminDeleteUserCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            Username: usernameId,
          }),
        )
        .catch((cleanupError: Error) =>
          this.logger.error(
            `could not roll back Cognito user ${usernameId}: ${cleanupError.message}`,
          ),
        );
      throw new InternalServerErrorException('Could not register user, try again');
    }

    return {
      userSub,
      message:
        'Usuario registrado. Por favor, revise su correo electrónico para obtener el código de verificación.',
    };
  }

  async signIn(signInDto: SignInDto) {
    try {
      const command = new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: this.clientId,
        AuthParameters: {
          USERNAME: signInDto.email,
          PASSWORD: signInDto.password,
        },
      });

      const response = await this.cognitoClient.send(command);
      return {
        accessToken: response.AuthenticationResult?.AccessToken,
        idToken: response.AuthenticationResult?.IdToken,
        refreshToken: response.AuthenticationResult?.RefreshToken,
        expiresIn: response.AuthenticationResult?.ExpiresIn,
      };
    } catch (e) {
      throw toSafeAuthError(e, new UnauthorizedException('Invalid credentials'));
    }
  }

  async refreshToken(refreshToken: string) {
    try {
      const command = new InitiateAuthCommand({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: this.clientId,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
        },
      });

      const response = await this.cognitoClient.send(command);
      return {
        accessToken: response.AuthenticationResult?.AccessToken,
        idToken: response.AuthenticationResult?.IdToken,
        refreshToken: response.AuthenticationResult?.RefreshToken,
        expiresIn: response.AuthenticationResult?.ExpiresIn,
      };
    } catch (e) {
      throw toSafeAuthError(e, new UnauthorizedException('Invalid refresh token'));
    }
  }

  async changePassword(accessToken: string, oldPassword: string, newPassword: string) {
    try {
      const command = new ChangePasswordCommand({
        AccessToken: accessToken,
        PreviousPassword: oldPassword,
        ProposedPassword: newPassword,
      });

      await this.cognitoClient.send(command);

      return { message: 'Password changed successfully' };
    } catch (error) {
      throw toSafeAuthError(error, new BadRequestException('Could not change password'));
    }
  }

  async revokeToken(refreshToken: string) {
    try {
      const command = new RevokeTokenCommand({
        ClientId: this.clientId,
        Token: refreshToken,
      });

      await this.cognitoClient.send(command);

      return { message: 'Token revoked successfully' };
    } catch (error) {
      throw toSafeAuthError(error, new BadRequestException('Could not revoke token'));
    }
  }

  async me(id: string) {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['avatar'],
    });

    if (!user) return user;

    return { ...user, avatar: await this.mediaService.signUrl(user.avatar) };
  }
}
