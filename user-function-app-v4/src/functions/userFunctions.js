import { app } from '@azure/functions';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { withCorrelation, success, failure } from '../utils/shared.js';
import { PublicClientApplication } from '@azure/msal-node';
import { validateEntraIDToken, getUserFromGraph, inviteUserToEntraID, extractBearerToken, TENANT_ID, CLIENT_ID, AUTHORITY, DEFAULT_AUTH_SCOPES } from '../utils/entraAuth.js';

const safeStringify = (value) => {
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
    } catch (stringifyError) {
        return `"[Unserializable value: ${stringifyError.message}]"`;
    }
};

// Setup validation with email format support
const ajv = new Ajv();
addFormats(ajv);

const createUserSchema = {
    type: 'object',
    properties: {
        username: { type: 'string', minLength: 3 },
        email: { type: 'string', format: 'email' }
    },
    required: ['username', 'email'],
    additionalProperties: false
};
const validateCreateUser = ajv.compile(createUserSchema);

// Authentication schemas
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

const signUpSchema = {
    type: 'object',
    properties: {
        username: { type: 'string', minLength: 3 },
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 },
        firstName: { type: 'string', minLength: 1 },
        lastName: { type: 'string', minLength: 1 }
    },
    required: ['username', 'email', 'password', 'firstName', 'lastName'],
    additionalProperties: false
};
const validateSignUp = ajv.compile(signUpSchema);

// Shared Entra ID/MSAL configuration
const CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET || process.env.CLIENT_SECRET || null;
const AUTH_SCOPES_STRING = (process.env.ENTRA_AUTH_SCOPES || DEFAULT_AUTH_SCOPES).split(/[\s,]+/).filter(Boolean).join(' ');
const TOKEN_SCOPES_STRING = (process.env.ENTRA_TOKEN_SCOPES || `${AUTH_SCOPES_STRING} offline_access`).split(/[\s,]+/).filter(Boolean).join(' ');
const ROPC_SCOPES = (process.env.ENTRA_ROPC_SCOPES || TOKEN_SCOPES_STRING).split(/[\s,]+/).filter(Boolean);

const NATIVE_AUTH_CLIENT_ID = process.env.NATIVE_AUTH_CLIENT_ID || process.env.ENTRA_NATIVE_CLIENT_ID || process.env.ENTRA_ROPC_CLIENT_ID || CLIENT_ID;
const NATIVE_AUTH_TENANT_SUBDOMAIN = process.env.NATIVE_AUTH_TENANT_SUBDOMAIN || process.env.NATIVE_AUTH_TENANT || null;
const NATIVE_AUTH_BASE_URL = process.env.NATIVE_AUTH_BASE_URL || (NATIVE_AUTH_TENANT_SUBDOMAIN
    ? `https://${NATIVE_AUTH_TENANT_SUBDOMAIN}.ciamlogin.com/${NATIVE_AUTH_TENANT_SUBDOMAIN}.onmicrosoft.com`
    : null);
const NATIVE_AUTH_SCOPES_STRING = (process.env.NATIVE_AUTH_SCOPES || TOKEN_SCOPES_STRING || 'openid profile').split(/[\s,]+/).filter(Boolean).join(' ');
const NATIVE_AUTH_CHALLENGE_TYPES = (process.env.NATIVE_AUTH_CHALLENGE_TYPES || 'password redirect').split(/[\s,]+/).filter(Boolean);
const NATIVE_AUTH_ENABLED = (process.env.NATIVE_AUTH_ENABLED || '').toLowerCase() === 'true'
    || (!!NATIVE_AUTH_CLIENT_ID && !!NATIVE_AUTH_BASE_URL);

const usernamePasswordClient = new PublicClientApplication({
    auth: {
        clientId: process.env.ENTRA_ROPC_CLIENT_ID || CLIENT_ID,
        authority: process.env.ENTRA_ROPC_AUTHORITY || AUTHORITY
    }
});

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

const callNativeAuthEndpoint = async (path, params, correlationId, context) => {
    if (!NATIVE_AUTH_ENABLED || !NATIVE_AUTH_BASE_URL) {
        throw new NativeAuthError('Native authentication is not configured', {
            status: 500,
            path,
            params: sanitizeNativeParams(params)
        });
    }

    const url = `${NATIVE_AUTH_BASE_URL}${path}`;
    const fetchFn = await resolveFetch();
    const body = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            body.append(key, value);
        }
    });

    try {
        context.log(`[NativeAuth] POST ${path}`, safeStringify({ correlationId, params: sanitizeNativeParams(params) }));
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
                context.log.warn(`[NativeAuth] Failed to parse JSON from ${path}`, safeStringify({
                    correlationId,
                    message: parseError?.message,
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

const normalizeNativeAuthError = (error, correlationId, context) => {
    if (!(error instanceof NativeAuthError)) {
        context.log.error('[NativeAuth] Unexpected error type', safeStringify({ correlationId, message: error?.message }));
        return {
            status: 500,
            message: 'Authentication failed due to an unexpected error.',
            info: { message: error?.message }
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

    if (code === 'invalid_grant' || httpStatus === 400) {
        httpStatus = 401;
        message = 'Invalid username or password, or additional verification is required.';

        if (subError === 'password_reset_required') {
            message = 'Password reset required before signing in.';
        } else if (subError === 'password_expired') {
            message = 'Password expired. Reset your password and try again.';
        } else if (subError === 'invalid_oob_value') {
            message = 'Invalid verification code. Request a new code and try again.';
        } else if (subError === 'attributes_required') {
            message = 'Additional account attributes are required to complete sign-in.';
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
    } else if (code === 'redirect') {
        httpStatus = 400;
        message = 'Native authentication requires switching to the web sign-in flow.';
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

const buildChallengeTypeString = () => {
    const set = new Set(NATIVE_AUTH_CHALLENGE_TYPES.length ? NATIVE_AUTH_CHALLENGE_TYPES : ['password', 'redirect']);
    set.add('redirect');
    return Array.from(set).join(' ');
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

const nativePasswordSignIn = async ({ email, password, correlationId, context }) => {
    if (!NATIVE_AUTH_ENABLED) {
        throw new NativeAuthError('Native auth sign-in invoked without configuration');
    }

    const challengeTypeString = buildChallengeTypeString();

    try {
        const initiateData = await callNativeAuthEndpoint(
            '/oauth2/v2.0/initiate',
            {
                client_id: NATIVE_AUTH_CLIENT_ID,
                username: email,
                challenge_type: challengeTypeString
            },
            correlationId,
            context
        );

        if (initiateData?.challenge_type === 'redirect') {
            return failure(400, 'Native authentication requires using the hosted web sign-in flow.', correlationId, {
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
                '/oauth2/v2.0/challenge',
                {
                    client_id: NATIVE_AUTH_CLIENT_ID,
                    continuation_token: continuationToken,
                    challenge_type: challengeTypeString
                },
                correlationId,
                context
            );

            if (challengeData?.challenge_type === 'redirect') {
                return failure(400, 'Native authentication requires using the hosted web sign-in flow.', correlationId, {
                    code: 'redirect_required'
                });
            }

            continuationToken = challengeData?.continuation_token || continuationToken;
            challengeType = challengeData?.challenge_type || challengeType;

            if (challengeType && challengeType !== 'password') {
                context.log.warn('[NativeAuth] Unsupported challenge type received', safeStringify({
                    correlationId,
                    challengeType
                }));
                return failure(400, `Unsupported authentication challenge type: ${challengeType}`, correlationId, {
                    code: challengeType
                });
            }
        }

        const tokenData = await callNativeAuthEndpoint(
            '/oauth2/v2.0/token',
            {
                client_id: NATIVE_AUTH_CLIENT_ID,
                continuation_token: continuationToken,
                grant_type: 'password',
                password,
                scope: NATIVE_AUTH_SCOPES_STRING,
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
            scope: tokenData.scope || NATIVE_AUTH_SCOPES_STRING,
            expiresIn: expiresInSeconds,
            expiresOn: expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : null
        }, correlationId);
    } catch (error) {
        const normalized = normalizeNativeAuthError(error, correlationId, context);
        return failure(normalized.status, normalized.message, correlationId, normalized.info);
    }
};

// IMPORTANT: Health check MUST come before the {id} route
app.http('UserHealth', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'users/health',  // More specific route first
    handler: async (request, context) => {
        context.log('User health check requested');
        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            jsonBody: {
                service: 'users',
                status: 'healthy',
                timestamp: new Date().toISOString(),
                message: 'User service is running properly'
            }
        };
    }
});

// GET /api/auth/signin - OAuth2 Authorization Redirect
app.http('SignIn', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'auth/signin',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            const clientRedirectUri = process.env.CLIENT_REDIRECT_URI || 'http://localhost:3000/auth/callback';
            const serverRedirectUri = process.env.SERVER_REDIRECT_URI || 'https://func-auxili-user-dev-ad7stftg.azurewebsites.net/auth/callback';

            if (request.method.toUpperCase() === 'GET') {
                // Generate OAuth2 authorization URL for Entra ID
                const redirectUri = encodeURIComponent(serverRedirectUri);
                const scope = encodeURIComponent(AUTH_SCOPES_STRING);
                const state = encodeURIComponent(correlationId);
                const responseType = 'code';

                const authUrl = `${AUTHORITY}/oauth2/v2.0/authorize?` +
                    `client_id=${CLIENT_ID}&` +
                    `response_type=${responseType}&` +
                    `redirect_uri=${redirectUri}&` +
                    `scope=${scope}&` +
                    `state=${state}&` +
                    `response_mode=query`;

                context.log(`[SignIn] Redirecting to Entra ID: ${authUrl}`);

                return {
                    status: 302,
                    headers: {
                        'Location': authUrl,
                        'Access-Control-Allow-Origin': '*'
                    }
                };
            } else {
                // POST method - return authorization URL for SPA/API clients
                const redirectUri = clientRedirectUri; // For local development / configurable
                const scope = AUTH_SCOPES_STRING;

                const authUrl = `${AUTHORITY}/oauth2/v2.0/authorize?` +
                    `client_id=${CLIENT_ID}&` +
                    `response_type=code&` +
                    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
                    `scope=${encodeURIComponent(scope)}&` +
                    `state=${encodeURIComponent(correlationId)}&` +
                    `response_mode=query`;

                context.log(`[SignIn] Providing auth URL for client: ${authUrl}`);

                return success(200, {
                    authUrl,
                    clientId: CLIENT_ID,
                    tenantId: TENANT_ID,
                    redirectUri,
                    scope,
                    state: correlationId,
                    message: 'Use authUrl to authenticate with Azure Entra ID'
                }, correlationId);
            }

        } catch (error) {
            context.log.error(`[SignIn] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// POST /api/auth/password - Resource Owner Password Credentials (ROPC) login
app.http('PasswordSignIn', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'auth/password',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.warn(`[PasswordSignIn] Failed to parse request body: ${parseError.message}`);
                return failure(400, 'Invalid JSON payload', correlationId);
            }

            if (!validateSignIn(body)) {
                context.log.warn('[PasswordSignIn] Payload validation failed', validateSignIn.errors);
                return failure(400, 'Invalid credentials payload', correlationId, validateSignIn.errors);
            }

            const { email, password } = body;

            if (NATIVE_AUTH_ENABLED) {
                context.log('[PasswordSignIn] Using native authentication flow');
                return await nativePasswordSignIn({ email, password, correlationId, context });
            }

            context.log('[PasswordSignIn] Native auth disabled; falling back to ROPC flow');

            const ropcSnapshot = {
                authority: usernamePasswordClient?.config?.auth?.authority,
                clientId: usernamePasswordClient?.config?.auth?.clientId,
                scopes: ROPC_SCOPES,
                scopesCount: ROPC_SCOPES.length,
                usesCustomClientId: Boolean(process.env.ENTRA_ROPC_CLIENT_ID),
                usesCustomAuthority: Boolean(process.env.ENTRA_ROPC_AUTHORITY)
            };

            if (!ROPC_SCOPES.length) {
                context.log.error('[PasswordSignIn] No scopes configured for ROPC flow');
                return failure(500, 'Authentication misconfigured. Contact administrator.', correlationId);
            }

            context.log(`[PasswordSignIn] Attempting ROPC flow for ${email}`, ropcSnapshot);

            const tokenResponse = await usernamePasswordClient.acquireTokenByUsernamePassword({
                scopes: ROPC_SCOPES,
                username: email,
                password
            });

            if (!tokenResponse || !tokenResponse.accessToken) {
                context.log.error('[PasswordSignIn] MSAL returned an empty response');
                return failure(502, 'Authentication provider returned no tokens', correlationId);
            }

            const claims = tokenResponse.idTokenClaims || {};
            const expiresInSeconds = tokenResponse.expiresOn
                ? Math.max(0, Math.round((tokenResponse.expiresOn.getTime() - Date.now()) / 1000))
                : null;

            const user = {
                id: claims.sub || tokenResponse.account?.homeAccountId || null,
                username: claims.preferred_username || claims.email || email,
                email: claims.email || email,
                firstName: claims.given_name || '',
                lastName: claims.family_name || '',
                name: claims.name || claims.preferred_username || email,
                tenantId: claims.tid || tokenResponse.account?.tenantId || TENANT_ID
            };

            context.log(`[PasswordSignIn] User authenticated via ROPC: ${user.email}`);

            return success(200, {
                message: 'Authentication successful',
                user,
                accessToken: tokenResponse.accessToken,
                idToken: tokenResponse.idToken || null,
                refreshToken: tokenResponse.refreshToken || null,
                tokenType: tokenResponse.tokenType || 'Bearer',
                scope: Array.isArray(tokenResponse.scopes) && tokenResponse.scopes.length
                    ? tokenResponse.scopes.join(' ')
                    : ROPC_SCOPES.join(' '),
                expiresOn: tokenResponse.expiresOn ? tokenResponse.expiresOn.toISOString() : null,
                expiresIn: expiresInSeconds
            }, correlationId);
        } catch (error) {
            if (NATIVE_AUTH_ENABLED) {
                context.log.error('[PasswordSignIn] Native auth threw unexpected error', safeStringify({
                    correlationId,
                    message: error?.message
                }));
                const normalized = normalizeNativeAuthError(error, correlationId, context);
                return failure(normalized.status, normalized.message, correlationId, normalized.info);
            }

            context.log.error(`[PasswordSignIn] Entered ROPC catch block for correlation ${correlationId}`);
            const errorCode = (error?.errorCode || error?.name || 'unknown_error').toString();
            const subError = (error?.subError || error?.suberror || '').toString();
            const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : undefined;
            const msalCorrelationId = error?.correlationId || error?.correlation_id || null;

            const ropcSnapshot = {
                authority: usernamePasswordClient?.config?.auth?.authority,
                clientId: usernamePasswordClient?.config?.auth?.clientId,
                scopes: ROPC_SCOPES,
                scopesCount: ROPC_SCOPES.length
            };

            const safeDetails = {
                correlationId,
                errorCode,
                subError,
                statusCode,
                message: error?.message || error?.errorMessage || 'Unknown MSAL error',
                msalCorrelationId,
                authority: ropcSnapshot?.authority,
                clientId: ropcSnapshot?.clientId,
                scopes: ropcSnapshot?.scopes,
                timestamp: new Date().toISOString()
            };
            const serializedDetails = safeStringify(safeDetails);

            context.log.error(`[PasswordSignIn] Authentication failed: ${serializedDetails}`);
            if (error) {
                const rawSnapshot = {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    errorCode: error.errorCode,
                    subError: error.subError || error.suberror,
                    statusCode: error.statusCode,
                    correlationId: error.correlationId || error.correlation_id
                };
                context.log.error(`[PasswordSignIn] Raw error snapshot: ${safeStringify(rawSnapshot)}`);
            }

            const normalizedCode = errorCode.toLowerCase();
            const normalizedSubError = subError.toLowerCase();

            let status = 500;
            let message = 'Authentication failed. Verify the credentials and that the account allows password-based sign-in.';

            if (normalizedCode === 'invalid_grant' || statusCode === 400) {
                status = 401;
                message = 'Invalid username or password, or additional authentication is required.';
                if (normalizedSubError === 'consent_required' || normalizedSubError === 'interaction_required') {
                    message = 'Admin consent or interactive sign-in is required for this account. ROPC cannot continue.';
                }
                if (normalizedSubError === 'password_reset_required') {
                    message = 'Password reset required before signing in.';
                }
            } else if (normalizedCode === 'user_password_expired') {
                status = 403;
                message = 'User password expired. Please reset the password and try again.';
            } else if (normalizedCode === 'invalid_client') {
                status = 403;
                message = 'Client credentials are invalid for ROPC. Verify client ID and redirect URIs, or ensure ROPC is enabled for this app.';
            } else if (normalizedCode === 'unauthorized_client' || normalizedSubError === 'unauthorized_client') {
                status = 403;
                message = 'Application is not authorized for ROPC. Enable the flow in Entra ID or use another sign-in method.';
            } else if (normalizedCode === 'interaction_required') {
                status = 401;
                message = 'Interactive sign-in is required for this account. ROPC cannot satisfy additional challenges.';
            } else if (normalizedCode === 'temporarily_unavailable' || normalizedCode === 'service_not_available') {
                status = 503;
                message = 'Authentication service temporarily unavailable. Please try again shortly.';
            }

            return failure(status, message, correlationId, {
                code: errorCode,
                subError,
                statusCode,
                msalCorrelationId
            });
        }
    }
});

// GET /api/auth/callback - OAuth2 Callback Handler
app.http('AuthCallback', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'auth/callback',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        context.log(`[AuthCallback] Starting handler ${safeStringify({
            correlationId,
            requestUrl: request.url
        })}`);

        try {
            const url = new URL(request.url);
            context.log(`[AuthCallback] Parsed request URL ${safeStringify({
                correlationId,
                origin: url.origin,
                pathname: url.pathname
            })}`);
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');
            const errorDescription = url.searchParams.get('error_description');

            context.log(`[AuthCallback] Extracted query params ${safeStringify({
                correlationId,
                hasCode: Boolean(code),
                hasState: Boolean(state),
                hasError: Boolean(error)
            })}`);

            let callbackUrl;
            try {
                callbackUrl = `${url.origin}${url.pathname}`;
                context.log(`[AuthCallback] Computed callback URL ${safeStringify({
                    correlationId,
                    callbackUrl
                })}`);
            } catch (computeError) {
                context.log.error(`[AuthCallback] Failed to compute callback URL ${safeStringify({
                    correlationId,
                    message: computeError?.message,
                    stack: computeError?.stack
                })}`);
                console.error('AuthCallback compute callbackUrl error', computeError);
                throw computeError;
            }

            let serverRedirectUri;
            try {
                serverRedirectUri = process.env.SERVER_REDIRECT_URI || callbackUrl;
                context.log(`[AuthCallback] Resolved server redirect URI ${safeStringify({
                    correlationId,
                    serverRedirectUri,
                    hasEnvOverride: Boolean(process.env.SERVER_REDIRECT_URI)
                })}`);
            } catch (redirectError) {
                context.log.error(`[AuthCallback] Failed to resolve server redirect URI ${safeStringify({
                    correlationId,
                    message: redirectError?.message,
                    stack: redirectError?.stack
                })}`);
                console.error('AuthCallback resolve redirect error', redirectError);
                throw redirectError;
            }

            if (!process.env.SERVER_REDIRECT_URI) {
                context.log.warn(`[AuthCallback] SERVER_REDIRECT_URI not configured. Falling back to ${serverRedirectUri}`);
            }

            context.log(`[AuthCallback] Using redirect URI ${safeStringify({
                correlationId,
                callbackUrl,
                serverRedirectUri
            })}`);

            context.log(`[AuthCallback] Handling code exchange ${safeStringify({
                correlationId,
                state,
                callbackUrl,
                serverRedirectUri
            })}`);

            if (error) {
                context.log.error(`[AuthCallback] OAuth error: ${error} - ${errorDescription}`);
                return failure(400, `Authentication failed: ${errorDescription}`, correlationId);
            }

            if (!code) {
                context.log.error('[AuthCallback] No authorization code received');
                return failure(400, 'No authorization code received', correlationId);
            }

            // Exchange authorization code for tokens
            const tokenUrl = `${AUTHORITY}/oauth2/v2.0/token`;
            const tokenRequest = new URLSearchParams({
                client_id: CLIENT_ID,
                scope: TOKEN_SCOPES_STRING,
                code: code,
                redirect_uri: serverRedirectUri,
                grant_type: 'authorization_code',
            });

            if (CLIENT_SECRET) {
                tokenRequest.append('client_secret', CLIENT_SECRET);
            }

            const tokenRequestDetails = {
                tokenUrl,
                scopes: TOKEN_SCOPES_STRING,
                hasClientSecret: Boolean(CLIENT_SECRET),
                serverRedirectUri
            };

            const fetchFn = await resolveFetch();
            const fetchSource = typeof fetch === 'function' ? 'global-fetch' : 'node-fetch';

            context.log(`[AuthCallback] Initiating token exchange ${safeStringify({
                correlationId,
                tokenUrl,
                scopesLength: TOKEN_SCOPES_STRING?.split(/\s+/).filter(Boolean).length || 0,
                hasClientSecret: Boolean(CLIENT_SECRET),
                fetchSource
            })}`);

            const tokenResponse = await fetchFn(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: tokenRequest.toString()
            });

            const responseText = await tokenResponse.text();
            context.log(`[AuthCallback] Received token response status ${safeStringify({
                correlationId,
                status: tokenResponse.status,
                ok: tokenResponse.ok
            })}`);
            let tokenData = null;
            if (responseText) {
                try {
                    tokenData = JSON.parse(responseText);
                } catch (parseError) {
                    context.log.warn(`[AuthCallback] Token response not valid JSON ${safeStringify({
                        correlationId,
                        parseError: parseError.message,
                        responsePreview: responseText.substring(0, 500)
                    })}`);
                }
            }

            if (!tokenResponse.ok) {
                const status = tokenResponse.status;
                context.log.error(`[AuthCallback] Token exchange failed ${safeStringify({
                    status,
                    tokenRequest: tokenRequestDetails,
                    correlationId,
                    responseText: responseText?.substring(0, 1000) || null,
                    tokenData
                })}`);

                let errorMessage = 'Unknown token error';
                if (tokenData && (tokenData.error_description || tokenData.error)) {
                    errorMessage = tokenData.error_description || tokenData.error;
                    if (tokenData.error === 'invalid_grant') {
                        errorMessage += ' (Check that SERVER_REDIRECT_URI matches the redirect URI registered in Entra ID and APIM.)';
                    }
                } else if (responseText) {
                    errorMessage = `Unexpected token response: ${responseText.substring(0, 200)}...`;
                }

                return failure(status, `Token exchange failed: ${errorMessage}`, correlationId, tokenData || { rawResponse: responseText });
            }

            if (!tokenData || !tokenData.id_token) {
                context.log.error(`[AuthCallback] Missing id_token in response ${safeStringify({
                    correlationId,
                    tokenData,
                    responseText: responseText?.substring(0, 1000) || null
                })}`);
                return failure(400, 'Token exchange did not return an ID token', correlationId, tokenData || { rawResponse: responseText });
            }

            let idTokenPayload;
            try {
                idTokenPayload = decodeJwtPayload(tokenData.id_token);
            } catch (decodeError) {
                context.log.error('[AuthCallback] Failed to decode id_token payload', decodeError);
                return failure(400, 'Token exchange returned an invalid ID token', correlationId);
            }

            const user = {
                id: idTokenPayload.sub,
                username: idTokenPayload.preferred_username || idTokenPayload.email,
                email: idTokenPayload.email,
                firstName: idTokenPayload.given_name || '',
                lastName: idTokenPayload.family_name || '',
                name: idTokenPayload.name || ''
            };

            context.log(`[AuthCallback] Successfully authenticated user: ${user.email}`);

            // Return success with tokens and user info
            return success(200, {
                user,
                accessToken: tokenData.access_token,
                idToken: tokenData.id_token,
                refreshToken: tokenData.refresh_token,
                expiresIn: tokenData.expires_in,
                tokenType: tokenData.token_type,
                message: 'Authentication successful'
            }, correlationId);

        } catch (error) {
            context.log.error(`[AuthCallback] Entered catch block ${safeStringify({ correlationId })}`);
            context.log.error(`[AuthCallback] Unexpected error during callback handling ${safeStringify({
                name: error?.name,
                message: error?.message,
                stack: error?.stack,
                correlationId
            })}`);
            console.error('AuthCallback unexpected error', error);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// POST /api/auth/signup - Sign up endpoint (Entra ID User Invitation)
app.http('SignUp', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'auth/signup',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            const body = await request.json();

            if (!validateSignUp(body)) {
                context.log.warn('[SignUp] Validation failed', validateSignUp.errors);
                return failure(400, 'Invalid registration data', correlationId, validateSignUp.errors);
            }

            const { username, email, password, firstName, lastName } = body;
            const displayName = `${firstName} ${lastName}`;
            const clientRedirectUri = process.env.CLIENT_REDIRECT_URI || 'http://localhost:3000/auth/callback';

            // For signup, we need to invite the user to Entra ID
            // This requires admin consent and appropriate permissions
            // For now, return an invitation message that directs users to the OAuth flow

            const invitationResponse = {
                email: email,
                displayName: displayName,
                status: 'invitation_ready',
                message: 'To complete registration, please use the OAuth2 sign-in flow',
                authUrl: `${AUTHORITY}/oauth2/v2.0/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(clientRedirectUri)}&scope=${encodeURIComponent(AUTH_SCOPES_STRING)}&state=${correlationId}&response_mode=query`,
                instructions: [
                    '1. Use the provided authUrl to authenticate with Azure Entra ID',
                    '2. Complete the OAuth2 flow to get your access token',
                    '3. Your account will be automatically created in Entra ID upon first sign-in'
                ]
            };

            context.log(`[SignUp] User invitation prepared for: ${email}`);
            return success(201, invitationResponse, correlationId);

        } catch (error) {
            context.log.error(`[SignUp] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// GET /api/auth/keepalive - Keep alive endpoint
app.http('KeepAlive', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'auth/keepalive',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            // In real implementation, validate JWT token from Authorization header
            const authHeader = request.headers.get('authorization');

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return failure(401, 'No authorization token provided', correlationId);
            }

            const token = authHeader.substring(7); // Remove "Bearer " prefix

            // Validate JWT token with basic format checking
            const parts = token.split('.');
            if (parts.length !== 3) {
                context.log.warn(`[KeepAlive] Invalid JWT format: ${parts.length} parts`);
                return failure(401, 'Invalid JWT format', correlationId);
            }

            // Try to parse the payload for basic validation
            let payload;
            try {
                const addPadding = (str) => {
                    const missingPadding = str.length % 4;
                    if (missingPadding) {
                        str += '='.repeat(4 - missingPadding);
                    }
                    return str;
                };
                payload = JSON.parse(Buffer.from(addPadding(parts[1]), 'base64').toString());
            } catch (parseError) {
                context.log.warn(`[KeepAlive] Failed to decode JWT payload: ${parseError.message}`);
                return failure(401, 'Invalid JWT token', correlationId);
            }

            // Check if token is from Entra ID
            if (!payload.iss || !payload.iss.includes('microsoftonline.com')) {
                context.log.warn(`[KeepAlive] Invalid issuer: ${payload.iss}`);
                return failure(401, 'Token must be issued by Azure Entra ID', correlationId);
            }

            // Check expiration
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < now) {
                context.log.warn(`[KeepAlive] Token expired: ${payload.exp} < ${now}`);
                return failure(401, 'Token expired', correlationId);
            }

            const validation = await validateEntraIDToken(token);

            if (validation.valid) {
                // Calculate remaining time
                const now = Math.floor(Date.now() / 1000);
                const expiresIn = validation.claims?.exp ? validation.claims.exp - now : 3600;

                context.log('[KeepAlive] Entra ID token validated successfully');
                return success(200, {
                    status: 'active',
                    message: 'Session is valid',
                    timestamp: new Date().toISOString(),
                    expiresIn,
                    tokenType: 'Bearer',
                    user: validation.user
                }, correlationId);
            } else {
                context.log.warn(`[KeepAlive] Token validation failed: ${validation.error}`);
                return failure(401, 'Invalid or expired token', correlationId);
            }

        } catch (error) {
            context.log.error(`[KeepAlive] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// POST /api/auth/validate - JWT Token validation endpoint
app.http('ValidateToken', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'auth/validate',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.warn(`[ValidateToken] Failed to parse request body: ${parseError.message}`);
                return failure(400, 'Invalid JSON in request body', correlationId);
            }

            const { token } = body;

            if (!token) {
                return failure(400, 'Token is required', correlationId);
            }

            // Validate JWT token with Entra ID
            try {
                // Basic JWT format validation
                const parts = token.split('.');
                if (parts.length !== 3) {
                    context.log.warn(`[ValidateToken] Invalid JWT format: ${parts.length} parts`);
                    return failure(401, {
                        valid: false,
                        message: 'Invalid JWT format - token must have 3 parts'
                    }, correlationId);
                }

                // Try to parse the payload
                let payload;
                try {
                    const addPadding = (str) => {
                        const missingPadding = str.length % 4;
                        if (missingPadding) {
                            str += '='.repeat(4 - missingPadding);
                        }
                        return str;
                    };
                    payload = JSON.parse(Buffer.from(addPadding(parts[1]), 'base64').toString());
                } catch (parseError) {
                    context.log.warn(`[ValidateToken] Failed to decode JWT payload: ${parseError.message}`);
                    return failure(401, {
                        valid: false,
                        message: 'Invalid JWT - unable to decode token'
                    }, correlationId);
                }

                // For now, reject all tokens that don't come from Entra ID
                if (!payload.iss || !payload.iss.includes('microsoftonline.com')) {
                    context.log.warn(`[ValidateToken] Invalid issuer: ${payload.iss}`);
                    return failure(401, {
                        valid: false,
                        message: 'Token must be issued by Azure Entra ID'
                    }, correlationId);
                }

                // Check expiration
                const now = Math.floor(Date.now() / 1000);
                if (payload.exp && payload.exp < now) {
                    context.log.warn(`[ValidateToken] Token expired: ${payload.exp} < ${now}`);
                    return failure(401, {
                        valid: false,
                        message: 'Token expired'
                    }, correlationId);
                }

                context.log('[ValidateToken] Entra ID token is valid');
                return success(200, {
                    valid: true,
                    user: {
                        id: payload.sub,
                        username: payload.preferred_username || payload.email,
                        email: payload.email,
                        firstName: payload.given_name || '',
                        lastName: payload.family_name || '',
                        name: payload.name || ''
                    },
                    claims: payload,
                    message: 'Token is valid'
                }, correlationId);

            } catch (validationError) {
                context.log.error(`[ValidateToken] Validation error: ${validationError.message}`);
                return failure(401, {
                    valid: false,
                    message: 'Token validation failed'
                }, correlationId);
            }

        } catch (error) {
            context.log.error(`[ValidateToken] Unexpected error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});// GET /api/auth/me - Get current user profile
app.http('GetProfile', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'auth/me',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            // In real implementation, extract user info from validated JWT
            const authHeader = request.headers.get('authorization');

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return failure(401, 'No authorization token provided', correlationId);
            }

            const token = authHeader.substring(7);

            // Validate and extract user from JWT token using Entra ID validation
            const validation = await validateEntraIDToken(token);

            if (validation.valid) {
                const user = {
                    ...validation.user,
                    profile: {
                        firstName: validation.user.firstName,
                        lastName: validation.user.lastName,
                        joinDate: new Date(validation.claims.iat * 1000).toISOString().split('T')[0] // Convert from timestamp
                    },
                    lastLogin: new Date().toISOString(),
                    tokenClaims: {
                        issuer: validation.claims.iss,
                        audience: validation.claims.aud,
                        expires: new Date(validation.claims.exp * 1000).toISOString()
                    }
                };

                context.log('[GetProfile] Returning Entra ID user profile');
                return success(200, user, correlationId);
            } else {
                context.log.warn(`[GetProfile] Token validation failed: ${validation.error}`);
                return failure(401, 'Invalid or expired token', correlationId);
            }
        } catch (error) {
            context.log.error(`[GetProfile] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// GET /api/users/{id} - Get user from Entra ID (requires authentication)
app.http('GetUser', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'users/{id}',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const id = request.params.id;

        // Prevent health being treated as an ID
        if (id === 'health') {
            return failure(400, 'Invalid user ID', correlationId);
        }

        try {
            // This endpoint requires authentication to access user data
            const authHeader = request.headers.get('authorization');
            const token = extractBearerToken(authHeader);

            if (!token) {
                return failure(401, 'Authentication required to access user data', correlationId);
            }

            // Validate the token
            const validation = await validateEntraIDToken(token);
            if (!validation.valid) {
                return failure(401, 'Invalid authentication token', correlationId);
            }

            // For security, only allow users to see their own profile or admin users
            if (validation.user.id !== id) {
                return failure(403, 'Access denied. You can only view your own profile', correlationId);
            }

            const user = {
                id: validation.user.id,
                username: validation.user.username,
                email: validation.user.email,
                firstName: validation.user.firstName,
                lastName: validation.user.lastName,
                name: validation.user.name,
                tenantId: validation.user.tenantId,
                profile: {
                    firstName: validation.user.firstName,
                    lastName: validation.user.lastName,
                    joinDate: new Date(validation.claims.iat * 1000).toISOString().split('T')[0]
                },
                timestamp: new Date().toISOString()
            };

            context.log(`[GetUser] Returning Entra ID user ${id}`);
            return success(200, user, correlationId);

        } catch (error) {
            context.log.error(`[GetUser] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// Combined Users Handler for GET/POST to /users (Entra ID authenticated)
app.http('UsersHandler', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'users',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            // Require authentication for user management operations
            const authHeader = request.headers.get('authorization');
            const token = extractBearerToken(authHeader);

            if (!token) {
                return failure(401, 'Authentication required for user management operations', correlationId);
            }

            // Validate the token
            const validation = await validateEntraIDToken(token);
            if (!validation.valid) {
                return failure(401, 'Invalid authentication token', correlationId);
            }

            if (request.method.toUpperCase() === 'GET') {
                // List users - for security, only return current user's info
                // In a real implementation, this would require admin privileges to list all users
                const users = [
                    {
                        id: validation.user.id,
                        username: validation.user.username,
                        email: validation.user.email,
                        firstName: validation.user.firstName,
                        lastName: validation.user.lastName,
                        name: validation.user.name
                    }
                ];

                context.log(`[ListUsers] Returning authenticated user info`);
                return success(200, { users, count: users.length, note: 'Only current user shown for security' }, correlationId);

            } else if (request.method.toUpperCase() === 'POST') {
                // Create user - redirect to signup flow since user creation should go through Entra ID
                return failure(400, 'User creation must be done through the /auth/signup endpoint with Entra ID integration', correlationId);
            }

            return failure(405, 'Method not allowed', correlationId);

        } catch (error) {
            context.log.error(`[UsersHandler] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});