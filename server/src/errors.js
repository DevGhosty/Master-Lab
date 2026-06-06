export class PublicError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "PublicError";
    this.status = options.status || 400;
    this.publicMessage = message;
    this.internalMessage = options.internalMessage || options.cause?.message || null;
    if (options.cause) this.cause = options.cause;
  }
}

export function clientErrorMessage(error, fallback = "Request failed") {
  return error?.publicMessage || fallback;
}

export function clientErrorStatus(error, fallback = 400) {
  return Number.isInteger(error?.status) ? error.status : fallback;
}

export function internalErrorMessage(error) {
  return error?.internalMessage || error?.message || String(error);
}
