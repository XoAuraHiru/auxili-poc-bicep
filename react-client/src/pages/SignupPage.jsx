import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import LoadingOverlay from "../components/LoadingOverlay.jsx";
import {
  signupStart,
  signupSendChallenge,
  signupVerifyCode,
  signupComplete,
} from "../services/authApi.js";

function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [step, setStep] = useState("form");
  const [otpCode, setOtpCode] = useState("");
  const [continuationToken, setContinuationToken] = useState(null);
  const [challengeTargetLabel, setChallengeTargetLabel] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [correlationId, setCorrelationId] = useState(null);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleStartSubmit = async (event) => {
    event.preventDefault();

    if (!form.firstName || !form.lastName || !form.email || !form.password) {
      setError("All fields are required.");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setCorrelationId(null);

    try {
      const startResponse = await signupStart({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        password: form.password,
      });

      let latestToken = startResponse?.continuationToken || null;
      let targetLabel = startResponse?.challengeTargetLabel || null;

      if (startResponse?.correlationId) {
        setCorrelationId(startResponse.correlationId);
      }

      const challengeResponse = await signupSendChallenge({
        continuationToken: latestToken,
      });

      if (challengeResponse?.continuationToken) {
        latestToken = challengeResponse.continuationToken;
      }
      if (challengeResponse?.challengeTargetLabel) {
        targetLabel = challengeResponse.challengeTargetLabel;
      }

      setContinuationToken(latestToken);
      setChallengeTargetLabel(targetLabel);
      setOtpCode("");
      setStep("otp");

      if (challengeResponse?.correlationId) {
        setCorrelationId(challengeResponse.correlationId);
      }
    } catch (err) {
      console.error("[SignupPage] Failed to start sign-up", err);
      setError(err?.message || "Unable to start sign-up. Please try again.");
      setCorrelationId(err?.data?.correlationId ?? err?.correlationId ?? null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event) => {
    event.preventDefault();

    if (!otpCode) {
      setError("Enter the verification code we sent to your email.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setCorrelationId(null);

    try {
      const verifyResponse = await signupVerifyCode({
        continuationToken,
        code: otpCode,
      });

      const nextToken = verifyResponse?.continuationToken || continuationToken;
      if (verifyResponse?.correlationId) {
        setCorrelationId(verifyResponse.correlationId);
      }

      const completeResponse = await signupComplete({
        continuationToken: nextToken,
        password: form.password,
      });

      if (completeResponse?.correlationId) {
        setCorrelationId(completeResponse.correlationId);
      }

      setStep("success");
      setOtpCode("");
    } catch (err) {
      console.error("[SignupPage] Verification failed", err);
      setError(err?.message || "Unable to verify the code. Please try again.");
      setCorrelationId(err?.data?.correlationId ?? err?.correlationId ?? null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReturnToLogin = () => {
    navigate("/auth/login", { replace: true });
  };

  const loadingMessage =
    step === "form"
      ? "Sending your verification code..."
      : "Completing your registration...";

  return (
    <section className="page page--auth">
      <div className="card card--centered">
        {step === "form" && (
          <>
            <h1>Create your Auxili account</h1>
            <p className="muted">
              Register with your email address to use native password
              authentication. We'll send a verification code to confirm your
              identity.
            </p>

            <form className="auth-form" onSubmit={handleStartSubmit}>
              <div className="form-group">
                <label htmlFor="firstName">First name</label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  autoComplete="given-name"
                  value={form.firstName}
                  onChange={handleInputChange}
                  disabled={isLoading}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="lastName">Last name</label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  autoComplete="family-name"
                  value={form.lastName}
                  onChange={handleInputChange}
                  disabled={isLoading}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Work or school email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={handleInputChange}
                  disabled={isLoading}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={handleInputChange}
                  disabled={isLoading}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm password</label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChange={handleInputChange}
                  disabled={isLoading}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn--primary"
                disabled={isLoading}
              >
                Send verification code
              </button>
            </form>

            <p className="muted">
              Already have an account? <Link to="/auth/login">Sign in</Link>.
            </p>
          </>
        )}

        {step === "otp" && (
          <>
            <h1>Verify your email</h1>
            <p className="muted">
              We sent a one-time code to{" "}
              <strong>{challengeTargetLabel || form.email}</strong>. Enter the
              code below to continue.
            </p>

            <form className="auth-form" onSubmit={handleOtpSubmit}>
              <div className="form-group">
                <label htmlFor="verificationCode">Verification code</label>
                <input
                  id="verificationCode"
                  name="verificationCode"
                  type="text"
                  inputMode="numeric"
                  value={otpCode}
                  onChange={(event) => setOtpCode(event.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn--primary"
                disabled={isLoading}
              >
                Confirm and finish sign-up
              </button>
            </form>

            <p className="muted">
              Didn’t receive a code? Check your spam folder or restart the
              sign-up process.
            </p>
          </>
        )}

        {step === "success" && (
          <>
            <h1>You're all set!</h1>
            <p className="muted">
              Your Auxili account is ready. You can now sign in with your email
              and password.
            </p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleReturnToLogin}
            >
              Go to sign-in
            </button>
          </>
        )}

        {isLoading && <LoadingOverlay message={loadingMessage} />}

        {error && (
          <div role="alert" className="error-message">
            <p>{error}</p>
            {correlationId && (
              <p className="muted mono">
                Correlation ID: <span>{correlationId}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default SignupPage;
