export interface GatewayResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
  };
}
