import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';

/**
 * Traduce errores de Cognito a respuestas seguras para el cliente. Nunca se
 * devuelve el error de AWS tal cual: trae metadata interna y mensajes que
 * permiten enumerar usuarios ("User does not exist" vs "Incorrect password").
 */
export const toSafeAuthError = (error: unknown, fallback: HttpException): HttpException => {
  if (error instanceof HttpException) return error;

  const name = (error as { name?: string })?.name;
  const message = (error as { message?: string })?.message;

  switch (name) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      return new UnauthorizedException('Invalid credentials');
    case 'UserNotConfirmedException':
      return new UnauthorizedException('User is not confirmed. Check your email.');
    case 'UsernameExistsException':
    case 'AliasExistsException':
      return new BadRequestException('Email already in use');
    // Mensajes de validación de Cognito: útiles para el usuario y sin datos internos.
    case 'InvalidPasswordException':
    case 'InvalidParameterException':
      return new BadRequestException(message ?? 'Invalid data');
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return new HttpException('Too many attempts, try again later', 429);
    default:
      return fallback;
  }
};
