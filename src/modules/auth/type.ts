export interface CognitoUser {
  sub: string;
  username: string;
  client_id: string;
  scope?: string;
  token_use: 'access' | 'id';
  exp: number;
  iat: number;
  iss: string;
  'cognito:groups'?: string[];
}

export interface AuthenticatedRequest extends Request {
  user: CognitoUser;
}
