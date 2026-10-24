export type ErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'stale_context'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'invalid_credentials'
  | 'model_unsupported'
  | 'malformed_output'
  | 'reference_invalid'
  | 'budget_exhausted'
  | 'timeout'
  | 'cancelled'
  | 'job_not_found';

export type BackendError = {
  code: ErrorCode;
  message: string; // user-safe: never prompts, keys, or resume text
  retryable: boolean;
  retryAfterMs?: number;
};

export class BackendFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'BackendFailure';
  }

  toJSON(): BackendError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.retryAfterMs !== undefined && { retryAfterMs: this.retryAfterMs }),
    };
  }
}

export function toBackendFailure(err: unknown): BackendFailure {
  if (err instanceof BackendFailure) return err;
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new BackendFailure('timeout', 'The request took too long.', true);
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new BackendFailure('cancelled', 'The request was cancelled.');
  }
  return new BackendFailure('provider_unavailable', 'Unexpected backend error.', true);
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  unauthorized: 401,
  budget_exhausted: 402,
  job_not_found: 404,
  stale_context: 409,
  cancelled: 409,
  rate_limited: 429,
  invalid_credentials: 502,
  model_unsupported: 502,
  malformed_output: 502,
  reference_invalid: 502,
  provider_unavailable: 503,
  timeout: 504,
};
