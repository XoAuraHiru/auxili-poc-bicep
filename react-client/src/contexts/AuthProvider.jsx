import { useCallback, useEffect, useMemo, useReducer } from "react";
import { AuthContext } from "./AuthContext.js";

const STORAGE_KEY = "auxili-auth-state";

const initialState = {
  user: null,
  tokens: null,
  isLoading: false,
  error: null,
  lastUpdated: null,
};

function initializeState() {
  if (typeof window === "undefined") {
    return initialState;
  }

  try {
    const cached = window.localStorage.getItem(STORAGE_KEY);
    if (!cached) {
      return initialState;
    }

    const parsed = JSON.parse(cached);
    if (!parsed || typeof parsed !== "object") {
      return initialState;
    }

    return {
      ...initialState,
      ...parsed,
      isLoading: false,
      error: null,
    };
  } catch (error) {
    console.warn("[AuthProvider] Failed to parse cached state", error);
    return initialState;
  }
}

function authReducer(state, action) {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    case "LOGIN_SUCCESS":
      return {
        ...state,
        user: action.payload.user,
        tokens: action.payload.tokens,
        isLoading: false,
        error: null,
        lastUpdated: Date.now(),
      };
    case "UPDATE_USER":
      return {
        ...state,
        user: action.payload,
        lastUpdated: Date.now(),
      };
    case "SET_TOKENS":
      return {
        ...state,
        tokens: action.payload,
        lastUpdated: Date.now(),
      };
    case "LOGOUT":
      return {
        ...initialState,
        lastUpdated: Date.now(),
      };
    default:
      return state;
  }
}

function persistState(user, tokens) {
  if (typeof window === "undefined") {
    return;
  }

  if (tokens && user) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, tokens }));
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(
    authReducer,
    initialState,
    initializeState
  );

  useEffect(() => {
    persistState(state.user, state.tokens);
  }, [state.user, state.tokens]);

  const setLoading = useCallback((payload) => {
    dispatch({ type: "SET_LOADING", payload });
  }, []);

  const setError = useCallback((payload) => {
    dispatch({ type: "SET_ERROR", payload });
  }, []);

  const login = useCallback(({ user, tokens }) => {
    dispatch({ type: "LOGIN_SUCCESS", payload: { user, tokens } });
  }, []);

  const logout = useCallback(() => {
    dispatch({ type: "LOGOUT" });
  }, []);

  const updateUser = useCallback((payload) => {
    dispatch({ type: "UPDATE_USER", payload });
  }, []);

  const setTokens = useCallback((payload) => {
    dispatch({ type: "SET_TOKENS", payload });
  }, []);

  const contextValue = useMemo(
    () => ({
      user: state.user,
      tokens: state.tokens,
      isLoading: state.isLoading,
      error: state.error,
      isAuthenticated: Boolean(state.tokens?.accessToken),
      login,
      logout,
      setLoading,
      setError,
      updateUser,
      setTokens,
      lastUpdated: state.lastUpdated,
    }),
    [
      state.user,
      state.tokens,
      state.isLoading,
      state.error,
      state.lastUpdated,
      login,
      logout,
      setLoading,
      setError,
      updateUser,
      setTokens,
    ]
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}
