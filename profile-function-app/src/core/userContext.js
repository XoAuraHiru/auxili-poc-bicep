import { ForbiddenError, UnauthorizedError } from '../errors/httpErrors.js';

const headerVariants = {
    id: ['x-user-object-id', 'x-ms-client-principal-id', 'x-user-id'],
    email: ['x-user-principal-name', 'x-user-email', 'x-app-user-email'],
    scopes: ['x-user-scopes', 'x-app-scopes'],
    environment: ['x-environment', 'x-app-environment']
};

const getHeaderValue = (headers, names) => {
    if (!headers?.get) {
        return null;
    }

    for (const name of names) {
        const value = headers.get(name);
        if (value) {
            const trimmed = String(value).trim();
            if (trimmed.length) {
                return trimmed;
            }
        }
    }
    return null;
};

export const normalizeToArray = (value) => {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value
            .map((entry) => String(entry).trim())
            .filter(Boolean);
    }

    return String(value)
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
};

export const getUserContext = (request) => {
    const headers = request?.headers;

    const id = getHeaderValue(headers, headerVariants.id);
    const email = getHeaderValue(headers, headerVariants.email);
    const scopesRaw = getHeaderValue(headers, headerVariants.scopes);
    const environment = getHeaderValue(headers, headerVariants.environment) ?? 'unknown';

    const scopes = normalizeToArray(scopesRaw).map((scope) => scope.toLowerCase());
    const scopeSet = new Set(scopes);

    return {
        id,
        email,
        environment,
        scopes,
        scopeSet
    };
};

export const ensureAuthenticated = (userContext) => {
    if (!userContext?.id) {
        throw new UnauthorizedError('User authentication required. Token missing or invalid.');
    }
};

export const ensureHasScope = (userContext, requiredScopes) => {
    const normalizedRequired = normalizeToArray(requiredScopes).map((scope) => scope.toLowerCase());
    if (!normalizedRequired.length) {
        return;
    }

    const userScopes = userContext?.scopeSet ?? new Set();
    const hasAny = normalizedRequired.some((scope) => userScopes.has(scope));

    if (!hasAny) {
        throw new ForbiddenError('Insufficient permissions. Required scope(s) missing.', {
            details: {
                requiredScopes: normalizedRequired,
                userScopes: Array.from(userScopes)
            },
            code: 'missing_scope'
        });
    }
};
