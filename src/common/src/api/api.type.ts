export interface ApiResponse<T> {
  ok: boolean;
  data: T | null;
  message?: string | string[];
}
