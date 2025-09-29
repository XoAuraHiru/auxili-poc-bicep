import { NativeAuthSdkError } from '../errors/NativeAuthSdkError.js';

const SUPPORTED_CHALLENGES = new Set(['password', 'oob', 'redirect', 'sms']);

const splitList = (value, fallback = '') => {
    const raw = value && value.length ? value : fallback;
    return String(raw)
        .split(/[,\s]+/)
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean)
        .filter((token) => SUPPORTED_CHALLENGES.has(token));
};

const ensureChallenges = (tokens, required = []) => {
    const merged = new Set(tokens);
    required.forEach((token) => {
        if (SUPPORTED_CHALLENGES.has(token)) {
            merged.add(token);
        }
    });
    return Array.from(merged);
};

const rawClientId = process.env.NATIVE_AUTH_CLIENT_ID || process.env.ENTRA_NATIVE_CLIENT_ID || '';
const rawTenantSubdomain = process.env.NATIVE_AUTH_TENANT_SUBDOMAIN || process.env.ENTRA_TENANT_SUBDOMAIN || '';

const resolveAuthority = () => {
    const explicit = process.env.NATIVE_AUTH_AUTHORITY || process.env.ENTRA_NATIVE_AUTHORITY || '';
    if (explicit) {
        return explicit.replace(/\/$/, '');
    }

    if (!rawTenantSubdomain) {
        return '';
    }

    const normalized = rawTenantSubdomain.trim().replace(/\.$/, '');
    if (!normalized) {
        return '';
    }

    return `https://${normalized}.ciamlogin.com/${normalized}.onmicrosoft.com`;
};

const authority = resolveAuthority();

const resolveBaseUrl = () => authority;

const resolveKnownAuthorities = () => {
    if (!authority) {
        return [];
    }

    try {
        const url = new URL(authority);
        return [url.hostname];
    } catch (error) {
        console.warn('[NativeAuthSDK] Unable to parse authority for known authorities', error?.message);
        return [];
    }
};

const scopes = (process.env.NATIVE_AUTH_SCOPES || 'openid profile email offline_access')
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);

const passwordChallenges = ensureChallenges(
    splitList(process.env.NATIVE_AUTH_PASSWORD_CHALLENGE, 'password redirect'),
    ['redirect']
);

const signupChallenges = ensureChallenges(
    splitList(process.env.NATIVE_AUTH_SIGNUP_CHALLENGES, 'oob password redirect'),
    ['redirect']
);

const toChallengeString = (values) => values.join(' ');

export const DEFAULT_EMAIL_DOMAIN = process.env.NATIVE_AUTH_DEFAULT_EMAIL_DOMAIN || null;

export const getNativeAuthSdkConfig = () => {
    if (!rawClientId) {
        throw new NativeAuthSdkError('NATIVE_AUTH_CLIENT_ID must be configured');
    }

    if (!authority) {
        throw new NativeAuthSdkError('Provide NATIVE_AUTH_AUTHORITY or NATIVE_AUTH_TENANT_SUBDOMAIN to resolve the authority');
    }

    return {
        clientId: rawClientId,
        authority,
        baseUrl: resolveBaseUrl(),
        knownAuthorities: resolveKnownAuthorities(),
        scopes,
        passwordChallenges,
        signupChallenges,
        passwordChallengeString: toChallengeString(passwordChallenges),
        signupChallengeString: toChallengeString(signupChallenges)
    };
};
