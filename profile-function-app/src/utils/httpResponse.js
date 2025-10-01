import { InternalServerError, isHttpError } from '../errors/httpErrors.js';
import { withCorrelationHeader } from './correlation.js';

const baseHeaders = (correlationId, headers = {}, includeContentType = true) => ({
    ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
    ...withCorrelationHeader(correlationId, headers)
});

export const successResponse = ({
    status = 200,
    data = null,
    meta = {},
    correlationId,
    headers = {}
}) => ({
    status,
    headers: baseHeaders(correlationId, headers),
    jsonBody: {
        data,
        meta: {
            correlationId,
            timestamp: new Date().toISOString(),
            ...meta
        }
    }
});

export const errorResponse = ({
    error,
    correlationId,
    headers = {}
}) => {
    const normalizedError = isHttpError(error) ? error : new InternalServerError();
    const body = {
        error: normalizedError.code ?? 'internal_error',
        message: normalizedError.message,
        correlationId
    };

    if (normalizedError.details) {
        body.details = normalizedError.details;
    }

    return {
        status: normalizedError.status,
        headers: baseHeaders(correlationId, headers),
        jsonBody: body
    };
};

export const noContentResponse = ({ correlationId, headers = {} }) => ({
    status: 204,
    headers: withCorrelationHeader(correlationId, headers)
});
