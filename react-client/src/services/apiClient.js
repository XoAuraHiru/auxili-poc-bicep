const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/?$/, '')

const SUBSCRIPTION_KEY_STORAGE_KEY = 'auxili.apim.subscriptionKey'

function readStoredSubscriptionKey() {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
        return null
    }

    try {
        const storedValue = window.localStorage.getItem(SUBSCRIPTION_KEY_STORAGE_KEY)
        if (!storedValue) {
            return null
        }

        const normalized = storedValue.trim()
        return normalized || null
    } catch (error) {
        console.warn('[apiClient] Unable to read stored subscription key:', error)
        return null
    }
}

function writeStoredSubscriptionKey(value) {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
        return
    }

    try {
        if (!value) {
            window.localStorage.removeItem(SUBSCRIPTION_KEY_STORAGE_KEY)
            return
        }

        window.localStorage.setItem(SUBSCRIPTION_KEY_STORAGE_KEY, String(value).trim())
    } catch (error) {
        console.warn('[apiClient] Unable to persist subscription key:', error)
    }
}

function resolveSubscriptionKey() {
    const globalTarget = typeof globalThis !== 'undefined' ? globalThis : {}
    const runtimeKey = globalTarget.__APIM_SUBSCRIPTION_KEY__ ?? globalTarget.APIM_SUBSCRIPTION_KEY ?? null

    if (runtimeKey) {
        const normalizedRuntimeKey = String(runtimeKey).trim()
        if (normalizedRuntimeKey) {
            return normalizedRuntimeKey
        }
    }

    const storedKey = readStoredSubscriptionKey()
    if (storedKey) {
        return storedKey
    }

    const env = import.meta.env || {}
    const envKey = env.APIM_SUBSCRIPTION_KEY ?? env.VITE_APIM_SUBSCRIPTION_KEY ?? null

    if (envKey) {
        const normalizedEnvKey = String(envKey).trim()
        if (normalizedEnvKey) {
            return normalizedEnvKey
        }
    }

    return null
}

if (!apiBaseUrl) {
    console.warn('[apiClient] Missing VITE_API_BASE_URL. Set it in your environment files.')
}

function buildUrl(path) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return `${apiBaseUrl}${normalizedPath}`
}

function buildHeaders(token, extraHeaders = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...extraHeaders
    }

    if (token) {
        headers.Authorization = `Bearer ${token}`
    }

    const defaultSubscriptionKey = resolveSubscriptionKey()
    if (defaultSubscriptionKey && !headers['Ocp-Apim-Subscription-Key']) {
        headers['Ocp-Apim-Subscription-Key'] = defaultSubscriptionKey
    }

    return headers
}

async function handleResponse(response) {
    const contentType = response.headers.get('content-type') || ''
    const isJson = contentType.includes('application/json')
    const data = isJson ? await response.json() : await response.text()

    if (!response.ok) {
        const error = new Error(data?.message || response.statusText)
        error.status = response.status
        error.data = data
        throw error
    }

    if (isJson && data && typeof data === 'object') {
        const { data: payload, correlationId, ...rest } = data

        if (payload !== undefined) {
            if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
                return {
                    ...payload,
                    correlationId: correlationId ?? null,
                    ...rest
                }
            }

            if (Array.isArray(payload)) {
                return {
                    items: payload,
                    correlationId: correlationId ?? null,
                    ...rest
                }
            }

            return payload
        }

        return {
            ...data
        }
    }

    return data
}

export async function apiRequest(path, { method = 'GET', body, headers, token, signal } = {}) {
    const url = buildUrl(path)
    const requestInit = {
        method,
        headers: buildHeaders(token, headers),
        body: body ? JSON.stringify(body) : undefined,
        signal
    }

    return fetch(url, requestInit).then(handleResponse)
}

export function getApiBaseUrl() {
    return apiBaseUrl
}

export function getSubscriptionKey() {
    return resolveSubscriptionKey()
}

export function persistSubscriptionKey(value) {
    writeStoredSubscriptionKey(value ? String(value).trim() : null)
}

export function clearStoredSubscriptionKey() {
    writeStoredSubscriptionKey(null)
}

export function getSubscriptionKeyStorageKey() {
    return SUBSCRIPTION_KEY_STORAGE_KEY
}
