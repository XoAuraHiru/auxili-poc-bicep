export function withCorrelation(context, request) {
    const existing = request.headers.get('x-correlation-id') || 
                    request.headers.get('X-Correlation-Id');
    const correlationId = existing || Math.random().toString(36).slice(2, 10);
    context.log(`[Correlation] ${correlationId}`);
    return correlationId;
}

export function success(status, data, correlationId) {
    return {
        status,
        headers: { "Content-Type": "application/json" },
        jsonBody: { correlationId, data }
    };
}

export function failure(status, message, correlationId, details) {
    return {
        status,
        headers: { "Content-Type": "application/json" },
        jsonBody: { correlationId, error: message, details }
    };
}