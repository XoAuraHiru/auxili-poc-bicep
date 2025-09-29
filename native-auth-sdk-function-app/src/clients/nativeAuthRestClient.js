import { safeStringify } from '../utils/shared.js';
import { NativeAuthSdkError } from '../errors/NativeAuthSdkError.js';

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

const sanitizeParams = (params) => {
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
    if (masked.oob) {
        masked.oob = '[REDACTED]';
    }
    if (masked.code) {
        masked.code = '[REDACTED]';
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
        context?.log?.('[NativeAuthSDK][REST] POST', safeStringify({
            correlationId,
            path,
            params: sanitizeParams(params)
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
            } catch (error) {
                context?.log?.warn?.('[NativeAuthSDK][REST] Failed to parse JSON', safeStringify({
                    correlationId,
                    path,
                    message: error?.message,
                    preview: responseText.substring(0, 400)
                }));
            }
        }

        if (!response.ok) {
            throw new NativeAuthSdkError(`Native auth REST request failed with status ${response.status}`, {
                status: response.status,
                code: data?.error,
                subError: data?.suberror || data?.sub_error,
                data
            });
        }

        return data || {};
    } catch (error) {
        if (error instanceof NativeAuthSdkError) {
            throw error;
        }

        throw new NativeAuthSdkError(error?.message || 'Native auth REST call failed', {
            data: {
                path,
                params: sanitizeParams(params)
            }
        });
    }
};
