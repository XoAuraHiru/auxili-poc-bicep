import { apiRequest } from './apiClient.js'

const AUTH_STATE_KEY = 'auxili-auth-state-param'

export function storeAuthState(state) {
    if (state) {
        sessionStorage.setItem(AUTH_STATE_KEY, state)
    }
}

export function consumeAuthState() {
    const state = sessionStorage.getItem(AUTH_STATE_KEY)
    if (state) {
        sessionStorage.removeItem(AUTH_STATE_KEY)
    }
    return state
}

export function clearAuthState() {
    sessionStorage.removeItem(AUTH_STATE_KEY)
}

export async function requestAuthUrl() {
    const response = await apiRequest('/auth/signin', { method: 'POST' })
    if (response?.state) {
        storeAuthState(response.state)
    }
    return response
}

export async function passwordSignIn({ email, password, signal } = {}) {
    if (!email || !password) {
        throw new Error('Email and password are required')
    }

    const payload = {
        email: String(email).trim(),
        password: String(password)
    }

    try {
        const response = await apiRequest('/auth/password', {
            method: 'POST',
            body: payload,
            signal
        })

        return {
            ...response,
            correlationId: response?.correlationId ?? null,
            message: response?.message || 'Authentication successful'
        }
    } catch (error) {
        if (error?.data) {
            error.correlationId = error.data?.correlationId ?? null
            error.code = error.data?.details?.code || error.data?.details?.error || error.code
        }
        throw error
    }
}

export function signupStart({ firstName, lastName, email, password, signal } = {}) {
    if (!firstName || !lastName || !email || !password) {
        throw new Error('First name, last name, email, and password are required')
    }

    const payload = {
        username: String(email).trim().toLowerCase(), // Native auth expects 'username' field
        password: String(password),
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim()
    }

    return apiRequest('/auth/signup/start', {
        method: 'POST',
        body: payload,
        signal
    })
}

export function signupSendChallenge({ continuationToken, signal } = {}) {
    if (!continuationToken) {
        throw new Error('Continuation token is required to send the verification code')
    }

    return apiRequest('/auth/signup/challenge', {
        method: 'POST',
        body: {
            continuationToken
        },
        signal
    })
}

export function signupVerifyCode({ continuationToken, code, signal } = {}) {
    if (!continuationToken) {
        throw new Error('Continuation token is required')
    }
    if (!code) {
        throw new Error('Verification code is required')
    }

    return apiRequest('/auth/signup/continue', {
        method: 'POST',
        body: {
            continuationToken,
            grantType: 'oob',
            code: String(code).trim()
        },
        signal
    })
}

export function signupComplete({ continuationToken, password, signal } = {}) {
    if (!continuationToken) {
        throw new Error('Continuation token is required')
    }
    if (!password) {
        throw new Error('Password is required')
    }

    return apiRequest('/auth/signup/continue', {
        method: 'POST',
        body: {
            continuationToken,
            grantType: 'password',
            password: String(password)
        },
        signal
    })
}

export async function exchangeAuthCode({ code, state }) {
    if (!code) {
        throw new Error('Missing authorization code')
    }

    const expectedState = consumeAuthState()
    if (expectedState && state && expectedState !== state) {
        throw new Error('State mismatch. Please restart the sign-in process.')
    }

    const query = new URLSearchParams({ code })
    const finalState = state || expectedState
    if (finalState) {
        query.set('state', finalState)
    }
    return apiRequest(`/auth/callback?${query.toString()}`)
}

export function validateToken(token) {
    return apiRequest('/auth/validate', {
        method: 'POST',
        body: { token }
    })
}

export function keepAlive(token) {
    return apiRequest('/auth/keepalive', {
        method: 'GET',
        token
    })
}

export function getProfile(token) {
    return apiRequest('/auth/me', {
        method: 'GET',
        token
    })
}

export function getUsers(token) {
    return apiRequest('/users', {
        method: 'GET',
        token
    })
}

export function getProducts(token) {
    return apiRequest('/products', {
        method: 'GET',
        token
    })
}

// Password reset functions
export function passwordResetStart({ username, signal } = {}) {
    if (!username) {
        throw new Error('Username (email) is required')
    }

    const payload = {
        username: String(username).trim().toLowerCase()
    }

    return apiRequest('/auth/password/reset/start', {
        method: 'POST',
        body: payload,
        signal
    })
}

export function passwordResetVerifyCode({ continuationToken, code, signal } = {}) {
    if (!continuationToken) {
        throw new Error('Continuation token is required')
    }
    if (!code) {
        throw new Error('Verification code is required')
    }

    return apiRequest('/auth/password/reset/continue', {
        method: 'POST',
        body: {
            continuationToken,
            grantType: 'oob',
            code: String(code).trim()
        },
        signal
    })
}

export function passwordResetComplete({ continuationToken, newPassword, signal } = {}) {
    if (!continuationToken) {
        throw new Error('Continuation token is required')
    }
    if (!newPassword) {
        throw new Error('New password is required')
    }

    return apiRequest('/auth/password/reset/continue', {
        method: 'POST',
        body: {
            continuationToken,
            grantType: 'password',
            newPassword: String(newPassword)
        },
        signal
    })
}
