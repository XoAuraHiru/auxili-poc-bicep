import { NativeAuthError } from '../errors/NativeAuthError.js';
import { safeStringify } from '../utils/shared.js';

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

const sanitizeNativeParams = (params) => {
    if (!params) {
        return params;
    }
    const masked = { ...params };
    if (masked.password) {
        masked.password = '[REDACTED]';
    }
    if (masked.new_password) {
        masked.new_password = '[REDACTED]';
    }
    if (masked.newPassword) {
        masked.newPassword = '[REDACTED]';
    }
    if (masked.oob) {
        masked.oob = '[REDACTED]';
    }
    return masked;
};

export const callNativeAuthEndpoint = async (config, path, params, correlationId, context) => {
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
            throw new NativeAuthError(`Native auth request failed with status ${response.status}`.trim(), {
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
