import { URL } from 'url';
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';

export class AuthorizationError extends Error {
    constructor(message, statusCode = 401, details = null) {
        super(message);
        this.name = 'AuthorizationError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

const parseList = (value) => {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }

    return String(value)
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
};

const getConfigured = (key, fallback) => {
    const raw = process.env[key];
    if ((raw === undefined || raw === null || raw === '') && fallback === undefined) {
        throw new Error(`${key} must be configured for authorization`);
    }
    return raw ?? fallback ?? null;
};

let cachedRemoteJwks = null;
let cachedJwksUri = null;

const getRemoteJwks = (overrideUri) => {
    const jwksUri = overrideUri || getConfigured('AUTH_JWKS_URI');

    if (!jwksUri) {
        throw new Error('AUTH_JWKS_URI environment variable is required');
    }

    if (!cachedRemoteJwks || cachedJwksUri !== jwksUri) {
        cachedJwksUri = jwksUri;
        cachedRemoteJwks = createRemoteJWKSet(new URL(jwksUri), {
            cacheMaxAge: Math.max(60000, (parseInt(process.env.AUTH_JWKS_CACHE_MS, 10) || 300000)),
            timeoutDuration: Math.max(5000, (parseInt(process.env.AUTH_HTTP_TIMEOUT_MS, 10) || 7000))
        });
    }

    return cachedRemoteJwks;
};

const extractBearerToken = (request) => {
    const raw = request.headers.get('authorization') || request.headers.get('Authorization');

    if (!raw || typeof raw !== 'string') {
        throw new AuthorizationError('Missing bearer token', 401, { code: 'missing_token' });
    }

    const parts = raw.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        throw new AuthorizationError('Invalid authorization header format', 401, { code: 'invalid_header' });
    }

    return parts[1];
};

const buildRoleSet = (claims) => {
    const roles = new Set();

    const pushValues = (value) => {
        if (!value) {
            return;
        }

        if (Array.isArray(value)) {
            value.forEach((item) => {
                if (item) {
                    roles.add(String(item));
                }
            });
            return;
        }

        if (typeof value === 'string') {
            value.split(/[\s,]+/).forEach((item) => {
                if (item) {
                    roles.add(item);
                }
            });
        }
    };

    if (claims && typeof claims === 'object') {
        pushValues(claims.roles);
        pushValues(claims.role);
        pushValues(claims.wids);
        pushValues(claims.groups);
    }

    return roles;
};

const buildScopeSet = (claims) => {
    const scopes = new Set();

    const pushValues = (value) => {
        if (!value) {
            return;
        }

        if (Array.isArray(value)) {
            value.forEach((item) => {
                if (item) {
                    scopes.add(String(item));
                }
            });
            return;
        }

        if (typeof value === 'string') {
            value.split(/[\s]+/).forEach((item) => {
                if (item) {
                    scopes.add(item);
                }
            });
        }
    };

    if (claims && typeof claims === 'object') {
        pushValues(claims.scp);
        pushValues(claims.scope);
    }

    return scopes;
};

const hasIntersection = (set, required) => {
    if (!required || !required.length) {
        return true;
    }

    if (!set || !(set instanceof Set)) {
        return false;
    }

    return required.some((item) => set.has(item));
};

const normalizeList = (value) => parseList(value).map((item) => item.toLowerCase());

const ensureTenantAllowed = (claims, allowedTenants) => {
    if (!allowedTenants || !allowedTenants.length) {
        return;
    }

    const tenant = (claims.tid || claims.tenantId || '').toLowerCase();
    if (!tenant || !allowedTenants.includes(tenant)) {
        throw new AuthorizationError('Tenant is not authorized to access this resource', 403, { code: 'tenant_forbidden' });
    }
};

const ensureClientAllowed = (claims, allowedClients) => {
    if (!allowedClients || !allowedClients.length) {
        return;
    }

    const appId = (claims.azp || claims.appid || claims.appId || '').toLowerCase();
    if (!appId || !allowedClients.includes(appId)) {
        throw new AuthorizationError('Client application is not authorized', 403, { code: 'client_forbidden' });
    }
};

const mapAudience = (overrideAudiences) => {
    const configuredAud = overrideAudiences || getConfigured('AUTH_AUDIENCE', null);
    const audiences = parseList(configuredAud);
    return audiences.length ? audiences : undefined;
};

const resolveIssuer = (overrideIssuer) => {
    const issuer = overrideIssuer || getConfigured('AUTH_ISSUER');
    if (!issuer) {
        throw new Error('AUTH_ISSUER environment variable is required');
    }
    return issuer;
};

const resolveClockTolerance = () => {
    const raw = process.env.AUTH_CLOCK_SKEW_SECONDS;
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
    }
    return 60;
};

const verifyJwt = async (token, options = {}) => {
    try {
        const audience = mapAudience(options.audience);
        const issuer = resolveIssuer(options.issuer);
        const jwks = getRemoteJwks(options.jwksUri);
        const clockTolerance = resolveClockTolerance();

        return await jwtVerify(token, jwks, {
            issuer,
            audience,
            clockTolerance,
            typ: options.type || 'JWT'
        });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            throw error;
        }

        if (error instanceof joseErrors.JWTInvalid) {
            throw new AuthorizationError('Token is invalid or malformed', 401, { code: 'invalid_token' });
        }

        if (error instanceof joseErrors.JWTExpired) {
            throw new AuthorizationError('Token has expired', 401, { code: 'token_expired' });
        }

        if (error instanceof joseErrors.JWTClaimValidationFailed) {
            throw new AuthorizationError('Token failed claim validation', 401, { code: 'claim_validation_failed', reason: error?.code });
        }

        throw new AuthorizationError('Unable to validate token signature', 401, { code: 'validation_failed', message: error?.message });
    }
};

export const authorizeRequest = async (request, context, options = {}) => {
    const token = extractBearerToken(request);
    const result = await verifyJwt(token, options);
    const claims = result.payload || {};

    try {
        ensureTenantAllowed(claims, normalizeList(options.allowedTenants || process.env.AUTH_ALLOWED_TENANTS));
        ensureClientAllowed(claims, normalizeList(options.allowedClients || process.env.AUTH_ALLOWED_CLIENTS));

        const roles = buildRoleSet(claims);
        const scopes = buildScopeSet(claims);

        const requiredRoles = parseList(options.requiredRoles || options.roles || process.env.AUTH_REQUIRED_ROLES);
        const requiredScopes = parseList(options.requiredScopes || options.scopes || process.env.AUTH_REQUIRED_SCOPES);

        if (requiredRoles.length && !hasIntersection(roles, requiredRoles)) {
            throw new AuthorizationError('Insufficient permissions for requested resource', 403, { code: 'missing_role', requiredRoles });
        }

        if (requiredScopes.length && !hasIntersection(scopes, requiredScopes)) {
            throw new AuthorizationError('Required API scope is missing from token', 403, { code: 'missing_scope', requiredScopes });
        }

        return {
            token,
            claims,
            header: result.protectedHeader,
            roles,
            scopes
        };
    } catch (error) {
        if (error instanceof AuthorizationError) {
            throw error;
        }

        context?.log?.error?.('[Authorization] Unexpected error', {
            message: error?.message
        });

        throw new AuthorizationError('Authorization failed due to an unexpected error', 500, { code: 'unexpected_error' });
    }
};

export const buildAuthFailureResponse = (error, correlationId) => {
    const status = error instanceof AuthorizationError ? error.statusCode : 401;
    const sanitizedMessage = status === 401
        ? 'Authentication is required to access this resource.'
        : 'You do not have permission to perform this action.';

    return {
        status,
        headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer'
        },
        jsonBody: {
            error: status === 401 ? 'unauthorized' : 'forbidden',
            message: sanitizedMessage,
            correlationId: correlationId || null
        }
    };
};
