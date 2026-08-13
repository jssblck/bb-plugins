export class OnePasswordError extends Error {
  override readonly name = "OnePasswordError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
