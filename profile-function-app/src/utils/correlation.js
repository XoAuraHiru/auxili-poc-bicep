import { randomUUID } from 'node:crypto';

const correlationHeaderCandidates = [
    'x-correlation-id',
    'x-ms-request-id',
    'x-request-id',
    'x-trace-id',
    'traceparent'
];

const normalizeHeaderValue = (value) => {
    if (!value) {
        return null;
    }
    const trimmed = String(value).trim();
    return trimmed.length ? trimmed : null;
};

export const resolveCorrelationId = (request) => {
    const headers = request?.headers;
    if (!headers?.get) {
        return randomUUID();
    }

    for (const headerName of correlationHeaderCandidates) {
        const candidate = normalizeHeaderValue(headers.get(headerName));
        if (candidate) {
            return candidate;
        }
    }

    return randomUUID();
};

export const withCorrelationHeader = (correlationId, headers = {}) => ({
    'X-Correlation-Id': correlationId,
    ...headers
});
