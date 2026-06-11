export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any[]
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: any[]) =>
  new ApiError(400, 'VALIDATION_ERROR', msg, details);
export const unauthorized = (msg = 'Not authenticated') => new ApiError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Not authorized for this action') => new ApiError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Not found') => new ApiError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string) => new ApiError(409, 'CONFLICT', msg);
export const businessRule = (msg: string) => new ApiError(422, 'BUSINESS_RULE_VIOLATION', msg);
