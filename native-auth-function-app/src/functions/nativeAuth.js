import { app } from '@azure/functions';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { safeStringify, withCorrelation, success, failure } from '../utils/shared.js';

const ajv = new Ajv({ allErrors: true, removeAdditional: false });
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

const signUpStartSchema = {
    type: 'object',
    properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 },
        firstName: { type: 'string', minLength: 1 },
        lastName: { type: 'string', minLength: 1 },
        attributes: {
            type: 'object',
            minProperties: 1,
            propertyNames: {
                type: 'string',
                minLength: 1
            },
            patternProperties: {
                '^.+$': {
                    anyOf: [
                        { type: 'string', minLength: 1 },
                        {
                            type: 'array',
                            minItems: 1,
                            items: { type: 'string', minLength: 1 }
                        },
                        { type: 'number' },
                        { type: 'boolean' }
                    ]
                }
            },
            additionalProperties: false
        }
    },
    required: ['email', 'password', 'firstName', 'lastName'],
    additionalProperties: false
};

const signUpChallengeSchema = {
    type: 'object',
    properties: {
        continuationToken: { type: 'string', minLength: 10 }
    },
    required: ['continuationToken'],
    additionalProperties: false
};

const signUpContinueSchema = {
    type: 'object',
    properties: {
        continuationToken: { type: 'string', minLength: 10 },
        grantType: { type: 'string', enum: ['oob', 'password'] },
        code: { type: 'string', minLength: 4 },
        password: { type: 'string', minLength: 6 }
    },
    required: ['continuationToken', 'grantType'],
    additionalProperties: false,
    allOf: [
        {
            if: {
                properties: {
                    grantType: { const: 'oob' }
                }
            },
            then: {
                required: ['code']
            }
        },
        {
            if: {
                properties: {
                    grantType: { const: 'password' }
                }
            },
            then: {
                required: ['password']
            }
        }
    ]
};

const validateSignUpStart = ajv.compile(signUpStartSchema);
const validateSignUpChallenge = ajv.compile(signUpChallengeSchema);
const validateSignUpContinue = ajv.compile(signUpContinueSchema);

const coalesce = (...values) => {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }
    return undefined;
};

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

const splitChallengeTypes = (value) => (value || '')
    .split(/[\s,]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

const resolveChallengeTypeString = (rawValue, fallbackTokens, requiredTokens = [], preferredOrder = []) => {
    const tokens = splitChallengeTypes(rawValue);
    const baseTokens = tokens.length ? tokens : Array.from(fallbackTokens || []);
    const tokenSet = new Set(baseTokens.map((token) => token.toLowerCase()));

    requiredTokens.forEach((token) => {
        if (token) {
            tokenSet.add(token.toLowerCase());
        }
    });

    const ordered = [];
    preferredOrder.forEach((token) => {
        const normalized = token.toLowerCase();
        if (tokenSet.has(normalized)) {
            ordered.push(normalized);
            tokenSet.delete(normalized);
        }
    });

    tokenSet.forEach((token) => {
        if (!ordered.includes(token)) {
            ordered.push(token);
        }
    });

    return ordered.join(' ');
};

const DEFAULT_SIGNIN_CHALLENGE_TYPES = ['password', 'redirect'];
const DEFAULT_SIGNUP_CHALLENGE_TYPES = ['oob', 'password', 'redirect'];

const RESOLVED_CHALLENGE_TYPE_STRING = resolveChallengeTypeString(
    process.env.NATIVE_AUTH_CHALLENGE_TYPES,
    DEFAULT_SIGNIN_CHALLENGE_TYPES,
    ['redirect'],
    ['password', 'oob', 'redirect']
);

const RESOLVED_SIGNUP_CHALLENGE_TYPE_STRING = resolveChallengeTypeString(
    process.env.NATIVE_AUTH_SIGNUP_CHALLENGE_TYPES || process.env.NATIVE_AUTH_CHALLENGE_TYPES,
    DEFAULT_SIGNUP_CHALLENGE_TYPES,
    ['redirect', 'oob'],
    ['oob', 'password', 'redirect', 'sms', 'email']
);

const DEFAULT_SIGNUP_ATTRIBUTE_MAP = {
    firstName: 'givenName',
    lastName: 'surname',
    displayName: 'displayName'
};

const parseJsonObjectEnv = (raw, envName) => {
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            console.warn(`[NativeAuth] ${envName} must be a JSON object value.`);
            return null;
        }
        return parsed;
    } catch (error) {
        console.warn(`[NativeAuth] Failed to parse ${envName}: ${error?.message}`);
        return null;
    }
};

const normalizeAttributeValue = (value) => {
    if (value === undefined || value === null) {
        return null;
    }
    if (Array.isArray(value)) {
        const normalizedItems = value
            .map((item) => normalizeAttributeValue(item))
            .filter(Boolean);
        if (!normalizedItems.length) {
            return null;
        }
        return normalizedItems.join(',');
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            return null;
        }
        return `${value}`;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
    }
    return null;
};

const SIGNUP_ATTRIBUTE_MAP = (() => {
    const overrides = parseJsonObjectEnv(process.env.NATIVE_AUTH_SIGNUP_ATTRIBUTE_MAP, 'NATIVE_AUTH_SIGNUP_ATTRIBUTE_MAP');
    const base = { ...DEFAULT_SIGNUP_ATTRIBUTE_MAP };
    if (!overrides) {
        return base;
    }
    Object.entries(overrides).forEach(([sourceKey, targetKey]) => {
        if (typeof targetKey === 'string' && targetKey.trim()) {
            base[String(sourceKey)] = targetKey.trim();
        }
    });
    return base;
})();

const SIGNUP_STATIC_ATTRIBUTES = (() => {
    const configured = parseJsonObjectEnv(process.env.NATIVE_AUTH_SIGNUP_STATIC_ATTRIBUTES, 'NATIVE_AUTH_SIGNUP_STATIC_ATTRIBUTES');
    if (!configured) {
        return {};
    }
    const normalized = {
        continuationToken: typeof body.continuationToken === 'string' ? body.continuationToken.trim() : body.continuationToken,
        grantType: typeof body.grantType === 'string' ? body.grantType.trim().toLowerCase() : body.grantType,
        code: typeof body.code === 'string' ? body.code.trim() : body.code,
        password: typeof body.password === 'string' ? body.password : body.password
    };
    console.log('Normalized:', normalized);
    Object.entries(configured).forEach(([attributeName, attributeValue]) => {
        const normalizedKey = typeof attributeName === 'string' ? attributeName.trim() : '';
        const normalizedValue = normalizeAttributeValue(attributeValue);
        if (!normalizedKey || !normalizedValue) {
            return;
        }
        if (normalizedKey.toLowerCase() === 'username' || normalizedKey.toLowerCase() === 'email') {
            return;
        }
        normalized[normalizedKey] = normalizedValue;
    });
    return normalized;
})();

const buildSignUpAttributesPayload = ({ firstName, lastName, extraAttributes }) => {
    const safeFirstName = typeof firstName === 'string' ? firstName.trim() : '';
    const safeLastName = typeof lastName === 'string' ? lastName.trim() : '';
    const valueBag = {
        firstName: safeFirstName,
        lastName: safeLastName,
        displayName: `${safeFirstName} ${safeLastName}`.replace(/\s+/g, ' ').trim()
    };

    const payload = {};

    Object.entries(SIGNUP_ATTRIBUTE_MAP).forEach(([sourceKey, attributeName]) => {
        if (!attributeName || typeof attributeName !== 'string') {
            return;
        }
        const normalizedKey = attributeName.trim();
        if (!normalizedKey || normalizedKey.toLowerCase() === 'username' || normalizedKey.toLowerCase() === 'email') {
            return;
        }
        const value = normalizeAttributeValue(valueBag[sourceKey]);
        if (value) {
            payload[normalizedKey] = value;
        }
    });

    if (extraAttributes && typeof extraAttributes === 'object' && !Array.isArray(extraAttributes)) {
        Object.entries(extraAttributes).forEach(([attributeName, attributeValue]) => {
            const normalizedKey = typeof attributeName === 'string' ? attributeName.trim() : '';
            if (!normalizedKey || normalizedKey.toLowerCase() === 'username' || normalizedKey.toLowerCase() === 'email') {
                return;
            }
            const normalizedValue = normalizeAttributeValue(attributeValue);
            if (normalizedValue) {
                payload[normalizedKey] = normalizedValue;
            }
        });
    }

    Object.entries(SIGNUP_STATIC_ATTRIBUTES).forEach(([attributeName, attributeValue]) => {
        if (attributeValue && attributeName) {
            payload[attributeName] = attributeValue;
        }
    });

    if (!Object.keys(payload).length) {
        return null;
    }

    return JSON.stringify(payload);
};

const normalizeSignUpContinuePayload = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return body;
    }

    // Start with a copy of the original body to preserve existing camelCase properties
    const normalized = { ...body };

    // Helper to find value from multiple possible keys (case-insensitive)
    const findValue = (...keys) => {
        for (const key of keys) {
            if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
                return body[key];
            }
            // Try lowercase version
            const lowerKey = typeof key === 'string' ? key.toLowerCase() : key;
            if (body[lowerKey] !== undefined && body[lowerKey] !== null && body[lowerKey] !== '') {
                return body[lowerKey];
            }
        }
        return undefined;
    };

    // Normalize continuationToken (keep original if exists, otherwise check aliases)
    const continuationToken = findValue('continuationToken', 'continuation_token', 'continuationtoken', 'continuation');
    if (continuationToken !== undefined) {
        normalized.continuationToken = String(continuationToken).trim();
    }

    // Normalize grantType (keep original if exists, otherwise check aliases)
    const grantType = findValue('grantType', 'grant_type', 'grant', 'type');
    if (grantType !== undefined) {
        normalized.grantType = String(grantType).trim().toLowerCase();
    }

    // Normalize code (keep original if exists, otherwise check aliases)
    const codeValue = findValue('code', 'verificationCode', 'verification_code', 'otp', 'oob', 'oneTimeCode', 'one_time_code');
    if (codeValue !== undefined) {
        normalized.code = String(codeValue).trim();
    }

    // Normalize password (keep original if exists, otherwise check aliases)
    const passwordValue = findValue('password', 'newPassword', 'new_password');
    if (passwordValue !== undefined) {
        normalized.password = String(passwordValue);
    }

    return normalized;
};

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
        challengeTypeString: RESOLVED_CHALLENGE_TYPE_STRING,
        signupChallengeTypeString: RESOLVED_SIGNUP_CHALLENGE_TYPE_STRING
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

const normalizeNativeSignUpError = (error, correlationId, context) => {
    if (!(error instanceof NativeAuthError)) {
        context.log.error('[NativeAuth][SignUp] Unexpected error type', safeStringify({ correlationId, message: error?.message }));
        return {
            status: 500,
            message: 'Registration failed due to an unexpected error.',
            info: {
                message: error?.message
            }
        };
    }

    const code = (error.code || '').toLowerCase();
    const subError = (error.subError || '').toLowerCase();
    const status = typeof error.status === 'number' && error.status > 0 ? error.status : undefined;
    const data = error.data && typeof error.data === 'object' ? error.data : null;
    const invalidAttributes = Array.isArray(data?.invalid_attributes) ? data.invalid_attributes : undefined;
    const requiredAttributes = Array.isArray(data?.required_attributes) ? data.required_attributes : undefined;

    context.log.warn('[NativeAuth][SignUp] API error', safeStringify({
        correlationId,
        status: error.status,
        code,
        subError,
        path: error.path,
        raw: error.rawResponse ? error.rawResponse.substring(0, 400) : null
    }));

    let httpStatus = status || 500;
    let message = 'Registration failed.';

    if (code === 'user_already_exists') {
        httpStatus = 409;
        message = 'An account with this email already exists. Try signing in instead.';
    } else if (code === 'invalid_email' || code === 'invalid_username') {
        httpStatus = 400;
        message = 'Enter a valid email address to sign up.';
    } else if (code === 'invalid_password') {
        httpStatus = 400;
        message = 'The password does not meet the policy requirements.';
    } else if (code === 'attributes_required') {
        httpStatus = 400;
        message = 'Additional profile information is required to complete registration.';
    } else if (code === 'redirect') {
        httpStatus = 400;
        message = 'Native sign-up is not available for this account. Complete registration using the hosted Microsoft experience.';
    } else if (code === 'invalid_grant') {
        if (subError === 'invalid_oob_value') {
            httpStatus = 400;
            message = 'The verification code is invalid or expired. Request a new code and try again.';
        } else if (subError === 'attribute_validation_failed') {
            httpStatus = 400;
            message = 'One or more profile fields need attention before we can finish creating your account.';
        } else if (subError === 'password_reset_required') {
            httpStatus = 409;
            message = 'Complete the password reset before signing up.';
        } else {
            httpStatus = 400;
            message = 'The provided information could not be validated.';
        }
    } else if (code === 'throttled') {
        httpStatus = 429;
        message = 'Too many sign-up attempts. Please wait a moment and try again.';
    }

    return {
        status: httpStatus,
        message,
        info: {
            code: error.code,
            subError: error.subError,
            status: error.status,
            path: error.path,
            requestParams: error.params,
            invalidAttributes,
            requiredAttributes,
            errorDescription: data?.error_description
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

const performNativeSignUpStart = async ({ email, password, firstName, lastName, additionalAttributes, correlationId, context }) => {
    const config = ensureNativeConfig();

    const attributes = buildSignUpAttributesPayload({
        firstName,
        lastName,
        extraAttributes: additionalAttributes
    });

    const params = {
        client_id: config.clientId,
        username: email,
        password,
        challenge_type: config.signupChallengeTypeString
    };

    if (attributes) {
        params.attributes = attributes;
    }

    const startData = await callNativeAuthEndpoint(
        config,
        '/signup/v1.0/start',
        params,
        correlationId,
        context
    );

    const continuationToken = startData?.continuation_token;

    if (!continuationToken) {
        throw new NativeAuthError('Native sign-up start response missing continuation token', {
            status: 500,
            data: startData,
            path: '/signup/v1.0/start'
        });
    }

    return success(200, {
        status: 'pending_verification',
        continuationToken,
        challengeType: startData?.challenge_type || null,
        challengeTargetLabel: startData?.challenge_target_label || null,
        message: 'Check your email for a verification code to continue registration.'
    }, correlationId);
};

const performNativeSignUpChallenge = async ({ continuationToken, correlationId, context }) => {
    const config = ensureNativeConfig();

    const challengeData = await callNativeAuthEndpoint(
        config,
        '/signup/v1.0/challenge',
        {
            client_id: config.clientId,
            continuation_token: continuationToken,
            challenge_type: config.signupChallengeTypeString
        },
        correlationId,
        context
    );

    const updatedContinuationToken = challengeData?.continuation_token || continuationToken;

    return success(200, {
        status: 'code_sent',
        continuationToken: updatedContinuationToken,
        challengeType: challengeData?.challenge_type || null,
        challengeTargetLabel: challengeData?.challenge_target_label || null,
        message: 'Verification code sent. Enter the code to continue.'
    }, correlationId);
};

const performNativeSignUpContinue = async ({ continuationToken, grantType, code, password, correlationId, context }) => {
    const config = ensureNativeConfig();
    const payload = {
        client_id: config.clientId,
        continuation_token: continuationToken,
        grant_type: grantType
    };

    if (grantType === 'oob') {
        payload.code = code;
    }

    if (grantType === 'password') {
        payload.password = password;
    }

    const continueData = await callNativeAuthEndpoint(
        config,
        '/signup/v1.0/continue',
        payload,
        correlationId,
        context
    );

    if (grantType === 'oob') {
        return success(200, {
            status: 'verify_password',
            continuationToken: continueData?.continuation_token || continuationToken,
            challengeType: continueData?.challenge_type || null,
            message: 'Code verified. Confirm your password to finish sign-up.'
        }, correlationId);
    }

    return success(201, {
        status: 'completed',
        message: 'Registration successful. You can now sign in with your password.',
        continuationToken: continueData?.continuation_token || null
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

app.http('NativeSignUpStart', {
    route: 'auth/signup/start',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        let body;
        try {
            body = await request.json();
        } catch (error) {
            context.log.warn('[NativeAuth][SignUpStart] Invalid JSON payload', safeStringify({ correlationId, message: error?.message }));
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        if (!validateSignUpStart(body)) {
            context.log.warn('[NativeAuth][SignUpStart] Payload validation failed', safeStringify({ correlationId, errors: validateSignUpStart.errors }));
            return failure(400, 'First name, last name, email, and password are required.', correlationId, validateSignUpStart.errors);
        }

        try {
            return await performNativeSignUpStart({
                email: String(body.email).trim(),
                password: String(body.password),
                firstName: String(body.firstName).trim(),
                lastName: String(body.lastName).trim(),
                additionalAttributes: body.attributes,
                correlationId,
                context
            });
        } catch (error) {
            const normalized = normalizeNativeSignUpError(error, correlationId, context);
            return failure(normalized.status, normalized.message, correlationId, normalized.info);
        }
    }
});

app.http('NativeSignUpChallenge', {
    route: 'auth/signup/challenge',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        let body;
        try {
            body = await request.json();
        } catch (error) {
            context.log.warn('[NativeAuth][SignUpChallenge] Invalid JSON payload', safeStringify({ correlationId, message: error?.message }));
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        if (!validateSignUpChallenge(body)) {
            context.log.warn('[NativeAuth][SignUpChallenge] Payload validation failed', safeStringify({ correlationId, errors: validateSignUpChallenge.errors }));
            return failure(400, 'A continuation token is required.', correlationId, validateSignUpChallenge.errors);
        }

        try {
            return await performNativeSignUpChallenge({
                continuationToken: String(body.continuationToken),
                correlationId,
                context
            });
        } catch (error) {
            const normalized = normalizeNativeSignUpError(error, correlationId, context);
            return failure(normalized.status, normalized.message, correlationId, normalized.info);
        }
    }
});

app.http('NativeSignUpContinue', {
    route: 'auth/signup/continue',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        let body;
        try {
            body = await request.json();
        } catch (error) {
            context.log.warn('[NativeAuth][SignUpContinue] Invalid JSON payload', safeStringify({ correlationId, message: error?.message }));
            return failure(400, 'Invalid JSON payload', correlationId);
        }

        const normalizedBody = normalizeSignUpContinuePayload(body);

        // Create a deep copy for validation to prevent AJV from modifying the original object
        const payloadForValidation = JSON.parse(JSON.stringify(normalizedBody));

        if (!validateSignUpContinue(payloadForValidation)) {
            return failure(400, 'Continuation token and grant type are required.', correlationId, validateSignUpContinue.errors);
        }

        const grantType = String(normalizedBody.grantType).toLowerCase();

        try {
            return await performNativeSignUpContinue({
                continuationToken: String(normalizedBody.continuationToken),
                grantType,
                code: grantType === 'oob' ? String(normalizedBody.code) : undefined,
                password: grantType === 'password' ? String(normalizedBody.password) : undefined,
                correlationId,
                context
            });
        } catch (error) {
            const normalized = normalizeNativeSignUpError(error, correlationId, context);
            return failure(normalized.status, normalized.message, correlationId, normalized.info);
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
