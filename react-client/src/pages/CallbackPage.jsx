import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import LoadingOverlay from "../components/LoadingOverlay.jsx";
import {
  clearAuthState,
  exchangeAuthCode,
  getProfile,
} from "../services/authApi.js";
import { useAuth } from "../hooks/useAuth.js";

function CallbackPage() {
  const [error, setError] = useState(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login, setLoading, updateUser } = useAuth();

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    async function completeLogin() {
      if (!code) {
        setError({
          message: "No authorization code provided. Try signing in again.",
          correlationId: null,
          details: null,
        });
        return;
      }

      try {
        setLoading(true);
        const response = await exchangeAuthCode({ code, state });

        if (!response?.accessToken || !response?.user) {
          throw new Error("Missing tokens in callback response");
        }

        const tokens = {
          accessToken: response.accessToken,
          idToken: response.idToken,
          refreshToken: response.refreshToken,
          expiresIn: response.expiresIn,
          tokenType: response.tokenType,
        };

        login({ user: response.user, tokens });

        try {
          const profile = await getProfile(tokens.accessToken);
          if (profile) {
            updateUser({ ...response.user, ...profile });
          }
        } catch (profileError) {
          console.warn("[CallbackPage] Failed to fetch profile", profileError);
        }

        navigate("/", { replace: true });
      } catch (err) {
        console.error("[CallbackPage] Sign-in completion failed", err);
        clearAuthState();
        const message =
          err?.data?.error || err?.message || "Unable to complete sign-in";
        setError({
          message,
          correlationId: err?.data?.correlationId ?? null,
          details: err?.data?.details ?? null,
        });
      } finally {
        setLoading(false);
      }
    }

    void completeLogin();
  }, [login, navigate, searchParams, setLoading, updateUser]);

  if (error) {
    return (
      <section className="page page--auth">
        <div className="card card--centered">
          <h1>Authentication error</h1>
          <p role="alert" className="error-message">
            {error.message}
          </p>
          {error.correlationId && (
            <p className="muted">
              Correlation ID:{" "}
              <span className="mono">{error.correlationId}</span>
            </p>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => navigate("/auth/login")}
          >
            Back to sign-in
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="page page--auth">
      <div className="card card--centered">
        <LoadingOverlay message="Completing sign-in with Azure Entra ID..." />
      </div>
    </section>
  );
}

export default CallbackPage;
