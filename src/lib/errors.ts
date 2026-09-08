export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError('bad_request', m, 400, d);
export const unauthorized = (m = '認証が必要です') => new AppError('unauthorized', m, 401);
export const forbidden = (m = '権限がありません') => new AppError('forbidden', m, 403);
export const notFound = (m = '対象が見つかりません') => new AppError('not_found', m, 404);
export const conflict = (m: string, d?: unknown) => new AppError('conflict', m, 409, d);
export const upstream = (m: string, d?: unknown) => new AppError('upstream_error', m, 502, d);
