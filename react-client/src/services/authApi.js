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

export async function passwordSignIn({ email, password }) {
    if (!email || !password) {
        throw new Error('Email and password are required')
    }

    const payload = {
        email: String(email).trim(),
        password: String(password)
    }

    return apiRequest('/auth/password', {
        method: 'POST',
        body: payload
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
