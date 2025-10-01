export class HttpError extends Error {
    constructor(status, message, { code, details } = {}) {
        super(message);
        this.name = new.target.name;
        this.status = status;
        this.code = code ?? null;
        this.details = details ?? null;
    }
}

export class BadRequestError extends HttpError {
    constructor(message = 'Bad request.', options = {}) {
        super(400, message, { code: options.code ?? 'bad_request', details: options.details });
    }
}

export class UnauthorizedError extends HttpError {
    constructor(message = 'User authentication required.', options = {}) {
        super(401, message, { code: options.code ?? 'unauthorized', details: options.details });
    }
}

export class ForbiddenError extends HttpError {
    constructor(message = 'Insufficient permissions.', options = {}) {
        super(403, message, { code: options.code ?? 'forbidden', details: options.details });
    }
}

export class NotFoundError extends HttpError {
    constructor(message = 'Resource not found.', options = {}) {
        super(404, message, { code: options.code ?? 'not_found', details: options.details });
    }
}

export class InternalServerError extends HttpError {
    constructor(message = 'Internal server error.', options = {}) {
        super(500, message, { code: options.code ?? 'internal_error', details: options.details });
    }
}

export const isHttpError = (error) => error instanceof HttpError;
