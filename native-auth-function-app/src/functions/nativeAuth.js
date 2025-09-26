import { app } from '@azure/functions';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { safeStringify, withCorrelation, success, failure } from '../utils/shared.js';

const ajv = new Ajv({ allErrors: true, removeAdditional: 'all' });
addFormats(ajv);

const signInSchema = {
    type: 'object',
    properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 }
    },
    required: ['email', 'password'],
    additionalProperties: false
};

const validateSignIn = ajv.compile(signInSchema);

const RAW_CLIENT_ID = process.env.NATIVE_AUTH_CLIENT_ID || process.env.ENTRA_NATIVE_CLIENT_ID || '';
const RAW_TENANT_SUBDOMAIN = process.env.NATIVE_AUTH_TENANT_SUBDOMAIN || process.env.ENTRA_TENANT_SUBDOMAIN || '';
const RAW_BASE_URL = process.env.NATIVE_AUTH_BASE_URL || '';
const RESOLVED_BASE_URL = (() => {
    if (RAW_BASE_URL) {
        return RAW_BASE_URL.replace(/\/$/, '');
    }
    if (RAW_TENANT_SUBDOMAIN) {
        const normalized = RAW_TENANT_SUBDOMAIN.trim().replace(/\.$/, '');
        return `https://${normalized}.ciamlogin.com/${normalized}.onmicrosoft.com`;
    }
    return '';
})();

const RESOLVED_SCOPES = (process.env.NATIVE_AUTH_SCOPES || 'openid profile email offline_access')
    .split(/[\s,]+/)
    .filter(Boolean)
    .join(' ');

const RESOLVED_CHALLENGE_TYPES = (() => {
    const values = (process.env.NATIVE_AUTH_CHALLENGE_TYPES || 'password redirect')
        .split(/[\s,]+/)
        .filter(Boolean);
    if (!values.includes('redirect')) {
        values.push('redirect');
    }
    return Array.from(new Set(values));
})();

let cachedFetch = null;
const resolveFetch = async () => {
    if (cachedFetch) {
        return cachedFetch;
    }
    if (typeof fetch === 'function') {
        cachedFetch = (...args) => fetch(...args);
        return cachedFetch;
    }
    const mod = await import('node-fetch');
    const nodeFetch = mod.default || mod;
    cachedFetch = (...args) => nodeFetch(...args);
    return cachedFetch;
};

class NativeAuthError extends Error {
    constructor(message, { status, data, rawResponse, path, params } = {}) {
        super(message);
        this.name = 'NativeAuthError';
        this.status = status;
        this.data = data || null;
        this.rawResponse = rawResponse || null;
        this.path = path;
        this.params = params;
        this.code = data?.error || null;
        this.subError = data?.suberror || data?.sub_error || null;
    }
}

const sanitizeNativeParams = (params) => {
    if (!params) {
        return params;
    }
    const masked = { ...params };
    if (masked.password) {
        masked.password = '[REDACTED]';
    }
    if (masked.oob) {
        masked.oob = '[REDACTED]';
    }
    return masked;
};

const ensureNativeConfig = () => {
    if (!RAW_CLIENT_ID) {
        throw new NativeAuthError('NATIVE_AUTH_CLIENT_ID must be configured');
    }
    if (!RESOLVED_BASE_URL) {
        throw new NativeAuthError('Provide NATIVE_AUTH_BASE_URL or NATIVE_AUTH_TENANT_SUBDOMAIN to build the native auth endpoints');
    }
    return {
        clientId: RAW_CLIENT_ID,
        baseUrl: RESOLVED_BASE_URL,
        scopes: RESOLVED_SCOPES,
        challengeTypeString: RESOLVED_CHALLENGE_TYPES.join(' ')
    };
};

const decodeJwtPayload = (jwt) => {
    const parts = jwt.split('.');
    if (parts.length !== 3) {
        throw new Error('Invalid JWT structure');
    }
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = Buffer.from(base64 + padding, 'base64').toString();
    return JSON.parse(decoded);
};

const callNativeAuthEndpoint = async (config, path, params, correlationId, context) => {
    const url = `${config.baseUrl}${path}`;
    const fetchFn = await resolveFetch();
    const body = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            body.append(key, value);
        }
    });

    try {
        context.log(`[NativeAuth] POST ${path}`, safeStringify({
            correlationId,
            params: sanitizeNativeParams(params)
        }));

        const response = await fetchFn(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body.toString()
        });

        const responseText = await response.text();
        let data = null;
        if (responseText) {
            try {
                data = JSON.parse(responseText);
            } catch (parseError) {
                context.log.warn('[NativeAuth] Non-JSON response received', safeStringify({
                    correlationId,
                    path,
                    responsePreview: responseText.substring(0, 400)
                }));
            }
        }

        if (!response.ok) {
            throw new NativeAuthError(`Native auth request failed with status ${response.status}`, {
                status: response.status,
                data,
                rawResponse: responseText,
                path,
                params: sanitizeNativeParams(params)
            });
        }

        context.log(`[NativeAuth] Success ${path}`, safeStringify({
            correlationId,
            status: response.status,
            hasContinuation: Boolean(data?.continuation_token),
            challengeType: data?.challenge_type || null
        }));

        return data || {};
    } catch (error) {
        if (error instanceof NativeAuthError) {
            throw error;
        }
        throw new NativeAuthError(error?.message || 'Native auth request failed', {
            path,
            params: sanitizeNativeParams(params)
        });
    }
};

const buildUserFromClaims = (claims, fallbackEmail) => ({
    id: claims?.sub || null,
    username: claims?.preferred_username || claims?.email || fallbackEmail || null,
    email: claims?.email || fallbackEmail || claims?.preferred_username || null,
    firstName: claims?.given_name || '',
    lastName: claims?.family_name || '',
    name: claims?.name || claims?.preferred_username || fallbackEmail || '',
    tenantId: claims?.tid || claims?.tenantId || null
});

const normalizeNativeAuthError = (error, correlationId, context) => {
    if (!(error instanceof NativeAuthError)) {
        context.log.error('[NativeAuth] Unexpected error type', safeStringify({ correlationId, message: error?.message }));
        return {
            status: 500,
            message: 'Authentication failed due to an unexpected error.',
            info: {
                message: error?.message
            }
        };
    }

    const code = (error.code || '').toLowerCase();
    const subError = (error.subError || '').toLowerCase();
    const status = typeof error.status === 'number' && error.status > 0 ? error.status : undefined;

    context.log.warn('[NativeAuth] API error', safeStringify({
        correlationId,
        status: error.status,
        code,
        subError,
        path: error.path,
        raw: error.rawResponse ? error.rawResponse.substring(0, 400) : null
    }));

    let httpStatus = status || 500;
    let message = 'Authentication failed.';

    if (code === 'redirect') {
        httpStatus = 400;
        message = 'Native authentication requires switching to the hosted Microsoft sign-in experience.';
    } else if (code === 'invalid_grant' || httpStatus === 400) {
        httpStatus = 401;
        message = 'Invalid username or password, or additional verification is required.';
        if (subError === 'password_reset_required') {
            message = 'Password reset required before signing in.';
        } else if (subError === 'password_expired') {
            message = 'Password expired. Reset the password and try again.';
        } else if (subError === 'invalid_oob_value') {
            message = 'Invalid verification code. Request a new code and try again.';
        }
    } else if (code === 'user_not_found') {
        httpStatus = 404;
        message = 'We couldn’t find an account with that email address.';
    } else if (code === 'invalid_request') {
        httpStatus = 400;
        message = 'The sign-in request was invalid. Please try again.';
    } else if (code === 'expired_token') {
        httpStatus = 401;
        message = 'The authentication session expired. Start the sign-in again.';
    } else if (code === 'unauthorized_client' || code === 'invalid_client' || subError === 'nativeauthapi_disabled') {
        httpStatus = 500;
        message = 'Native authentication is not enabled for this application.';
    }

    return {
        status: httpStatus,
        message,
        info: {
            code: error.code,
            subError: error.subError,
            status: error.status,
            path: error.path
        }
    };
};

const performNativePasswordSignIn = async ({ email, password, correlationId, context }) => {
    const config = ensureNativeConfig();
    const initiateData = await callNativeAuthEndpoint(
        config,
        '/oauth2/v2.0/initiate',
        {
            client_id: config.clientId,
            username: email,
            challenge_type: config.challengeTypeString
        },
        correlationId,
        context
    );

    if (initiateData?.challenge_type === 'redirect') {
        return failure(400, 'Native authentication requires using the hosted Microsoft sign-in flow.', correlationId, {
            code: 'redirect_required'
        });
    }

    let continuationToken = initiateData?.continuation_token || null;
    let challengeType = initiateData?.challenge_type || null;

    if (!continuationToken) {
        throw new NativeAuthError('Native auth initiate response missing continuation token', {
            status: 500,
            data: initiateData,
            path: '/oauth2/v2.0/initiate'
        });
    }

    if (!challengeType || challengeType !== 'password') {
        const challengeData = await callNativeAuthEndpoint(
            config,
            '/oauth2/v2.0/challenge',
            {
                client_id: config.clientId,
                continuation_token: continuationToken,
                challenge_type: config.challengeTypeString
            },
            correlationId,
            context
        );

        if (challengeData?.challenge_type === 'redirect') {
            return failure(400, 'Native authentication requires using the hosted Microsoft sign-in flow.', correlationId, {
                code: 'redirect_required'
            });
        }

        continuationToken = challengeData?.continuation_token || continuationToken;
        challengeType = challengeData?.challenge_type || challengeType;

        if (challengeType && challengeType !== 'password') {
            context.log.warn('[NativeAuth] Unsupported challenge type received', safeStringify({ correlationId, challengeType }));
            return failure(400, `Unsupported authentication challenge type: ${challengeType}`, correlationId, {
                code: challengeType
            });
        }
    }

    const tokenData = await callNativeAuthEndpoint(
        config,
        '/oauth2/v2.0/token',
        {
            client_id: config.clientId,
            continuation_token: continuationToken,
            grant_type: 'password',
            password,
            scope: config.scopes,
            username: email
        },
        correlationId,
        context
    );

    if (!tokenData?.id_token) {
        throw new NativeAuthError('Native auth token response missing id_token', {
            status: 500,
            data: tokenData,
            path: '/oauth2/v2.0/token'
        });
    }

    let claims;
    try {
        claims = decodeJwtPayload(tokenData.id_token);
    } catch (decodeError) {
        context.log.error('[NativeAuth] Failed to decode id_token', safeStringify({
            correlationId,
            message: decodeError?.message
        }));
        throw new NativeAuthError('Failed to decode id_token payload', {
            status: 500,
            data: tokenData,
            path: '/oauth2/v2.0/token'
        });
    }

    const user = buildUserFromClaims(claims, email);
    const expiresInSeconds = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : null;

    return success(200, {
        message: 'Authentication successful',
        user,
        accessToken: tokenData.access_token || null,
        idToken: tokenData.id_token,
        refreshToken: tokenData.refresh_token || null,
        tokenType: tokenData.token_type || 'Bearer',
        scope: tokenData.scope || config.scopes,
        expiresIn: expiresInSeconds,
        expiresOn: expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : null,
        correlationId
    }, correlationId);
};

app.http('NativeAuthHealth', {
    route: 'auth/health',
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            ensureNativeConfig();
            return success(200, {
                status: 'healthy',
                message: 'Native auth service is running',
                timestamp: new Date().toISOString()
            }, correlationId);
        } catch (error) {
            const details = error instanceof NativeAuthError ? { message: error.message } : undefined;
            return failure(500, 'Native auth service is misconfigured', correlationId, details);
        }
    }
});

app.http('NativePasswordSignIn', {
    route: 'auth/password',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        let body;
        try {
            body = await request.json();
        } catch (parseError) {
            context.log.warn('[NativeAuth] Invalid JSON payload', safeStringify({ correlationId, message: parseError?.message }));
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        if (!validateSignIn(body)) {
            context.log.warn('[NativeAuth] Payload validation failed', safeStringify({
                correlationId,
                errors: validateSignIn.errors
            }));
            return failure(400, 'Email and password are required', correlationId, validateSignIn.errors);
        }

        try {
            return await performNativePasswordSignIn({
                email: String(body.email).trim(),
                password: String(body.password),
                correlationId,
                context
            });
        } catch (error) {
            const normalized = normalizeNativeAuthError(error, correlationId, context);
            return failure(normalized.status, normalized.message, correlationId, normalized.info);
        }
    }
});
