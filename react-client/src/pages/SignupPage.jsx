import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import LoadingOverlay from "../components/LoadingOverlay.jsx";
import {
  signupStart,
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
  const [challengeIntervalSeconds, setChallengeIntervalSeconds] =
    useState(null);
  const [challengeCodeLength, setChallengeCodeLength] = useState(null);
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
      // Start the signup process with username, password, and attributes
      const startResponse = await signupStart({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        password: form.password,
      });

      // Set state from the start response
      setContinuationToken(startResponse?.continuationToken || null);
      setChallengeTargetLabel(
        startResponse?.challengeTargetLabel || form.email
      );
      setChallengeIntervalSeconds(
        typeof startResponse?.challengeIntervalSeconds === "number"
          ? startResponse.challengeIntervalSeconds
          : null
      );
      setChallengeCodeLength(
        typeof startResponse?.codeLength === "number"
          ? startResponse.codeLength
          : null
      );
      setCorrelationId(startResponse?.correlationId || null);
      setOtpCode("");
      setStep("otp");
    } catch (err) {
      console.error("[SignupPage] Failed to start sign-up", err);
      // Display errorDescription if available, otherwise fall back to message
      const errorMessage =
        err?.data?.details?.errorDescription ||
        err?.data?.error ||
        err?.message ||
        "Unable to start sign-up. Please try again.";
      setError(errorMessage);
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
      // First verify the OTP code
      const verifyResponse = await signupVerifyCode({
        continuationToken,
        code: otpCode,
      });

      if (verifyResponse?.correlationId) {
        setCorrelationId(verifyResponse.correlationId);
      }

      // Check if we need to set password or if signup is complete
      if (verifyResponse?.status === "verify_password") {
        // Need to set password in next step
        const nextToken =
          verifyResponse?.continuationToken || continuationToken;

        const completeResponse = await signupComplete({
          continuationToken: nextToken,
          password: form.password,
        });

        if (completeResponse?.correlationId) {
          setCorrelationId(completeResponse.correlationId);
        }
      }

      setStep("success");
      setOtpCode("");
    } catch (err) {
      console.error("[SignupPage] Verification failed", err);
      // Display errorDescription if available, otherwise fall back to message
      const errorMessage =
        err?.data?.details?.errorDescription ||
        err?.data?.error ||
        err?.message ||
        "Unable to verify the code. Please try again.";
      setError(errorMessage);
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
              {challengeIntervalSeconds ? (
                <>
                  {" "}
                  You may need to wait at least {challengeIntervalSeconds}s
                  before requesting another code.
                </>
              ) : null}
              {challengeCodeLength ? (
                <> Codes are {challengeCodeLength} characters long.</>
              ) : null}
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
