export const safeStringify = (value) => {
    try {
        const cache = new WeakSet();
        return JSON.stringify(value, (key, val) => {
            if (val instanceof Error) {
                return {
                    name: val.name,
                    message: val.message,
                    stack: val.stack
                };
            }
            if (typeof val === 'object' && val !== null) {
                if (cache.has(val)) {
                    return '[Circular]';
                }
                cache.add(val);
            }
            return val;
        });
    } catch (error) {
        return `"[Unserializable value: ${error.message}]"`;
    }
};

export const withCorrelation = (context, request) => {
    const headerId = request.headers.get('x-correlation-id') || request.headers.get('X-Correlation-Id');
    const correlationId = headerId || Math.random().toString(36).slice(2, 10);
    context.log(`[Correlation] ${correlationId}`);
    return correlationId;
};

export const success = (status, data, correlationId) => ({
    status,
    headers: {
        'Content-Type': 'application/json'
    },
    jsonBody: {
        correlationId,
        data
    }
});

export const failure = (status, message, correlationId, details) => ({
    status,
    headers: {
        'Content-Type': 'application/json'
    },
    jsonBody: {
        correlationId,
        error: message,
        details
    }
});
