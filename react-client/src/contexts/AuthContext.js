import { createContext } from 'react'

export const AuthContext = createContext({
    user: null,
    tokens: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    login: () => undefined,
    logout: () => undefined,
    setLoading: () => undefined,
    setError: () => undefined,
    updateUser: () => undefined,
    setTokens: () => undefined,
    lastUpdated: null
})

AuthContext.displayName = 'AuthContext'
