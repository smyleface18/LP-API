import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignUpDto } from './dto/signUp.dto';
import { v4 } from 'uuid';
import { SignInDto } from './dto/signIn.dto';
import { UserRoles } from 'src/db/enum/roles.enum';
import { Repository } from 'typeorm';
import { User } from 'src/db/entities';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class AuthService {
  private cognitoClient: CognitoIdentityProviderClient;
  private clientId: string;

  constructor(
    private configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    const region = this.configService.get('AWS_REGION') as string;
    this.clientId = this.configService.get('COGNITO_CLIENT_ID') as string;

    this.cognitoClient = new CognitoIdentityProviderClient({
      region,
    });
  }

  async signUp(signUpDto: SignUpDto) {
    try {
      const existingUser = await this.userRepository.findOne({
        where: { email: signUpDto.email },
      });
      if (existingUser) {
        throw new BadRequestException('Email already in use');
      }

      const usernameId = v4();
      const command = new SignUpCommand({
        ClientId: this.clientId,
        Username: usernameId,
        Password: signUpDto.password,
        UserAttributes: [
          { Name: 'email', Value: signUpDto.email },
          { Name: 'nickname', Value: signUpDto.username },
        ],
      });

      const response = await this.cognitoClient.send(command);

      // 2. Asignar grupo por defecto
      const grupo = new AdminAddUserToGroupCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        GroupName: UserRoles.PLAYER,
        Username: usernameId,
      });

      await this.cognitoClient.send(grupo);

      const user = this.userRepository.create({
        id: usernameId,
        email: signUpDto.email,
        username: signUpDto.username,
      });

      await this.userRepository.save(user);

      return {
        userSub: response.UserSub,
        message: 'User registered. Please check your email for verification code.',
      };
    } catch (error) {
      throw new BadRequestException(error);
    }
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
      throw new UnauthorizedException(e, 'Invalid credentials');
    }
  }
}
