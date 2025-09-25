import { useMemo, useState } from "react";
import LoadingOverlay from "../components/LoadingOverlay.jsx";
import { useAuth } from "../hooks/useAuth.js";
import {
  clearAuthState,
  getProducts,
  getProfile,
  getUsers,
  keepAlive,
  validateToken,
} from "../services/authApi.js";

function prettify(data) {
  try {
    return JSON.stringify(data, null, 2);
  } catch (err) {
    return typeof err?.message === "string" ? err.message : String(data);
  }
}

function DashboardPage() {
  const { user, tokens, setLoading, isLoading, updateUser, logout } = useAuth();
  const [apiResult, setApiResult] = useState(null);
  const [apiError, setApiError] = useState(null);

  const accessTokenPreview = useMemo(() => {
    if (!tokens?.accessToken) {
      return null;
    }
    return `${tokens.accessToken.slice(0, 18)}…${tokens.accessToken.slice(
      -10
    )}`;
  }, [tokens]);

  const clearResults = () => {
    setApiResult(null);
    setApiError(null);
  };

  const handleKeepAlive = async () => {
    if (!tokens?.accessToken) return;
    clearResults();
    try {
      setLoading(true);
      const response = await keepAlive(tokens.accessToken);
      setApiResult({ title: "Keep alive", response });
    } catch (error) {
      setApiError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async () => {
    if (!tokens?.idToken) return;
    clearResults();
    try {
      setLoading(true);
      const response = await validateToken(tokens.idToken);
      setApiResult({ title: "Token validation", response });
    } catch (error) {
      setApiError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshProfile = async () => {
    if (!tokens?.accessToken) return;
    clearResults();
    try {
      setLoading(true);
      const profile = await getProfile(tokens.accessToken);
      setApiResult({ title: "Profile refreshed", response: profile });
      updateUser({ ...user, ...profile });
    } catch (error) {
      setApiError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleFetchUsers = async () => {
    if (!tokens?.accessToken) return;
    clearResults();
    try {
      setLoading(true);
      const response = await getUsers(tokens.accessToken);
      setApiResult({ title: "Users API", response });
    } catch (error) {
      setApiError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleFetchProducts = async () => {
    if (!tokens?.accessToken) return;
    clearResults();
    try {
      setLoading(true);
      const response = await getProducts(tokens.accessToken);
      setApiResult({ title: "Products API", response });
    } catch (error) {
      setApiError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    clearAuthState();
    logout();
  };

  return (
    <section className="page">
      <div className="content-grid">
        <div className="card">
          <header className="card__header">
            <h2>Signed in user</h2>
            <p className="muted">
              Data returned by `/auth/callback` and `/auth/me`.
            </p>
          </header>
          <div className="card__body">
            {user ? (
              <dl className="definition-list">
                <dt>Name</dt>
                <dd>
                  {user.name ||
                    `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
                    "—"}
                </dd>
                <dt>Email</dt>
                <dd>{user.email}</dd>
                <dt>Tenant</dt>
                <dd>{user.tenantId || "—"}</dd>
                <dt>User ID</dt>
                <dd className="mono">{user.id}</dd>
                {user.profile?.joinDate && (
                  <>
                    <dt>Joined</dt>
                    <dd>{user.profile.joinDate}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p>No user loaded.</p>
            )}
          </div>
          <footer className="card__footer">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleRefreshProfile}
              disabled={isLoading}
            >
              Refresh profile
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleLogout}
            >
              Sign out
            </button>
          </footer>
        </div>

        <div className="card">
          <header className="card__header">
            <h2>Tokens</h2>
            <p className="muted">
              Stored securely in memory and localStorage for this demo.
            </p>
          </header>
          <div className="card__body">
            <dl className="definition-list">
              <dt>Access token</dt>
              <dd>{accessTokenPreview || "—"}</dd>
              <dt>ID token</dt>
              <dd>
                {tokens?.idToken ? `${tokens.idToken.slice(0, 18)}…` : "—"}
              </dd>
              <dt>Expires in</dt>
              <dd>{tokens?.expiresIn ? `${tokens.expiresIn} seconds` : "—"}</dd>
            </dl>
          </div>
          <footer className="card__footer">
            <button
              type="button"
              className="btn"
              onClick={handleKeepAlive}
              disabled={isLoading}
            >
              Keep alive
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleValidate}
              disabled={isLoading}
            >
              Validate ID token
            </button>
          </footer>
        </div>

        <div className="card">
          <header className="card__header">
            <h2>Call our APIs</h2>
            <p className="muted">
              Requires the Bearer token issued during sign-in.
            </p>
          </header>
          <div className="card__body card__body--stack">
            <button
              type="button"
              className="btn btn--wide"
              onClick={handleFetchUsers}
              disabled={isLoading}
            >
              GET /users
            </button>
            <button
              type="button"
              className="btn btn--wide"
              onClick={handleFetchProducts}
              disabled={isLoading}
            >
              GET /products
            </button>
          </div>
        </div>

        <div className="card card--span">
          <header className="card__header">
            <h2>Latest API response</h2>
          </header>
          <div className="card__body">
            {isLoading && (
              <LoadingOverlay message="Calling Azure Functions..." />
            )}
            {!isLoading && apiResult && (
              <div>
                <p className="muted">{apiResult.title}</p>
                <pre className="code-block">
                  <code>{prettify(apiResult.response)}</code>
                </pre>
              </div>
            )}
            {!isLoading && apiError && (
              <div className="error-block" role="alert">
                <p className="muted">Request failed</p>
                <pre className="code-block">
                  <code>
                    {prettify({
                      status: apiError.status,
                      message: apiError.message,
                      data: apiError.data,
                    })}
                  </code>
                </pre>
              </div>
            )}
            {!isLoading && !apiResult && !apiError && (
              <p className="muted">
                Trigger a request above to see responses from Azure.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default DashboardPage;
