import { NativeAuthError } from '../errors/NativeAuthError.js';

const splitChallengeTypes = (value) => (value || '')
    .split(/[,\s]+/)
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

const RAW_CLIENT_ID = process.env.NATIVE_AUTH_CLIENT_ID || process.env.ENTRA_NATIVE_CLIENT_ID || '';
const RAW_TENANT_SUBDOMAIN = process.env.NATIVE_AUTH_TENANT_SUBDOMAIN || process.env.ENTRA_TENANT_SUBDOMAIN || '';
const RAW_BASE_URL = process.env.NATIVE_AUTH_BASE_URL || '';

const resolveBaseUrl = () => {
    if (RAW_BASE_URL) {
        return RAW_BASE_URL.replace(/\/$/, '');
    }

    if (RAW_TENANT_SUBDOMAIN) {
        const normalized = RAW_TENANT_SUBDOMAIN.trim().replace(/\.$/, '');
        if (normalized) {
            return `https://${normalized}.ciamlogin.com/${normalized}.onmicrosoft.com`;
        }
    }

    return '';
};

const RESOLVED_BASE_URL = resolveBaseUrl();

const RESOLVED_SCOPES = (process.env.NATIVE_AUTH_SCOPES || 'openid profile email offline_access')
    .split(/[,\s]+/)
    .filter(Boolean)
    .join(' ');

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

    const normalized = {};

    Object.entries(configured).forEach(([attributeName, attributeValue]) => {
        const normalizedKey = typeof attributeName === 'string' ? attributeName.trim() : '';
        const normalizedValue = normalizeAttributeValue(attributeValue);

        if (!normalizedKey || !normalizedValue) {
            return;
        }

        if (['username', 'email'].includes(normalizedKey.toLowerCase())) {
            return;
        }

        normalized[normalizedKey] = normalizedValue;
    });

    return normalized;
})();

export const getNativeAuthConfig = () => {
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

export const getSignUpAttributeMap = () => ({ ...SIGNUP_ATTRIBUTE_MAP });
export const getSignUpStaticAttributes = () => ({ ...SIGNUP_STATIC_ATTRIBUTES });
export { normalizeAttributeValue };
