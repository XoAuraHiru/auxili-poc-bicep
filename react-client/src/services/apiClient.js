const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/?$/, '')
const subscriptionKey = import.meta.env.VITE_APIM_SUBSCRIPTION_KEY || null

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

    if (subscriptionKey && !headers['Ocp-Apim-Subscription-Key']) {
        headers['Ocp-Apim-Subscription-Key'] = subscriptionKey
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

export async function apiRequest(path, { method = 'GET', body, headers, token } = {}) {
    const url = buildUrl(path)
    const requestInit = {
        method,
        headers: buildHeaders(token, headers),
        body: body ? JSON.stringify(body) : undefined
    }

    return fetch(url, requestInit).then(handleResponse)
}

export function getApiBaseUrl() {
    return apiBaseUrl
}

export function getSubscriptionKey() {
    return subscriptionKey
}
