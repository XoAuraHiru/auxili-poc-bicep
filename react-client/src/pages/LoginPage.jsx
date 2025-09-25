import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import LoadingOverlay from "../components/LoadingOverlay.jsx";
import {
  getProfile,
  passwordSignIn,
  requestAuthUrl,
} from "../services/authApi.js";
import { getApiBaseUrl } from "../services/apiClient.js";
import { useAuth } from "../hooks/useAuth.js";

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isPasswordSubmitting, setIsPasswordSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formCorrelationId, setFormCorrelationId] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { login, setLoading, updateUser, setError: setAuthError } = useAuth();
  const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID || "Not set";
  const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID || "Not set";
  const hasSubscriptionKey = Boolean(
    import.meta.env.VITE_APIM_SUBSCRIPTION_KEY
  );
  const passwordLoginEnabled =
    String(
      import.meta.env.VITE_ENABLE_PASSWORD_SIGNIN ?? "true"
    ).toLowerCase() !== "false";

  const handleSignIn = async () => {
    try {
      setAuthError?.(null);
      setFormError(null);
      setFormCorrelationId(null);
      setIsRedirecting(true);
      const response = await requestAuthUrl();
      if (!response?.authUrl) {
        throw new Error(
          "API did not return an authUrl. Check backend configuration."
        );
      }
      window.location.assign(response.authUrl);
    } catch (err) {
      console.error("[LoginPage] Sign-in failed", err);
      setFormError(err.message || "Unable to start sign-in flow");
      setIsRedirecting(false);
    }
  };

  const handlePasswordSignIn = async (event) => {
    event.preventDefault();

    if (!passwordLoginEnabled) {
      return;
    }

    try {
      setAuthError?.(null);
      setFormError(null);
      setFormCorrelationId(null);

      if (!email || !password) {
        setFormError("Email and password are required");
        return;
      }

      setIsPasswordSubmitting(true);
      setLoading?.(true);

      const response = await passwordSignIn({ email, password });

      if (!response?.accessToken || !response?.user) {
        throw new Error("Authentication response did not include tokens");
      }

      const tokens = {
        accessToken: response.accessToken,
        idToken: response.idToken,
        refreshToken: response.refreshToken,
        expiresIn: response.expiresIn,
        tokenType: response.tokenType,
        scope: response.scope,
        expiresOn: response.expiresOn,
      };

      login({ user: response.user, tokens });

      try {
        const profile = await getProfile(tokens.accessToken);
        if (profile) {
          updateUser({ ...response.user, ...profile });
        }
      } catch (profileError) {
        console.warn("[LoginPage] Failed to fetch profile", profileError);
      }

      setEmail("");
      setPassword("");

      const redirectPath = location.state?.from?.pathname || "/";
      navigate(redirectPath, { replace: true });
    } catch (err) {
      console.error("[LoginPage] Password sign-in failed", err);
      const message = err?.data?.error || err?.message || "Unable to sign in";
      setFormError(message);
      setFormCorrelationId(
        err?.data?.correlationId ?? err?.correlationId ?? null
      );
      setAuthError?.({
        message,
        correlationId: err?.data?.correlationId ?? null,
      });
    } finally {
      setIsPasswordSubmitting(false);
      setLoading?.(false);
    }
  };

  const showLoading =
    isRedirecting || (passwordLoginEnabled && isPasswordSubmitting);
  const loadingMessage = isRedirecting
    ? "Redirecting to Azure Entra ID..."
    : "Signing you in with corporate credentials...";

  return (
    <section className="page page--auth">
      <div className="card card--centered">
        <h1>Sign in to Auxili</h1>
        <p className="muted">
          This demo uses Azure Entra ID via our Azure Functions `/auth`
          endpoints. Clicking the button below will redirect you to Microsoft
          for authentication.
        </p>

        <div className="info-panel">
          <h2>Environment</h2>
          <dl>
            <dt>API Base URL</dt>
            <dd>
              {getApiBaseUrl() || (
                <span className="badge badge--warning">Not configured</span>
              )}
            </dd>
            <dt>Entra client ID</dt>
            <dd className="mono">{clientId}</dd>
            <dt>Tenant ID</dt>
            <dd className="mono">{tenantId}</dd>
            <dt>APIM subscription key</dt>
            <dd>
              {hasSubscriptionKey ? (
                "Configured"
              ) : (
                <span className="badge badge--warning">Not configured</span>
              )}
            </dd>
            <dt>After sign-in</dt>
            <dd>
              You&apos;ll be redirected to `/auth/callback` and brought back to{" "}
              {location.state?.from?.pathname || "the dashboard"}.
            </dd>
          </dl>
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleSignIn}
            disabled={showLoading}
          >
            Sign in with Microsoft
          </button>
        </div>

        {passwordLoginEnabled && (
          <>
            <div className="divider">
              <span>or</span>
            </div>

            <form className="auth-form" onSubmit={handlePasswordSignIn}>
              <div className="form-group">
                <label htmlFor="email">Work or school email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={showLoading}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={showLoading}
                  required
                />
              </div>
              <button
                type="submit"
                className="btn btn--secondary"
                disabled={showLoading}
              >
                Sign in with email & password
              </button>
            </form>
          </>
        )}

        {showLoading && <LoadingOverlay message={loadingMessage} />}

        {formError && (
          <div role="alert" className="error-message">
            <p>{formError}</p>
            {formCorrelationId && (
              <p className="muted mono">
                Correlation ID: <span>{formCorrelationId}</span>
              </p>
            )}
          </div>
        )}

        <div className="hint">
          <p className="muted">
            Demo account: <code>demo@auxili.com</code> /{" "}
            <code>password123</code>
          </p>
        </div>
      </div>
    </section>
  );
}

export default LoginPage;
