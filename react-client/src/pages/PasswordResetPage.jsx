import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import LoadingOverlay from "../components/LoadingOverlay.jsx";
import {
  passwordResetStart,
  passwordResetVerifyCode,
  passwordResetComplete,
} from "../services/authApi.js";

function PasswordResetPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [step, setStep] = useState("start");
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

    if (!form.username) {
      setError("Email address is required.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setCorrelationId(null);

    try {
      const startResponse = await passwordResetStart({
        username: form.username,
      });

      // Set state from the start response
      setContinuationToken(startResponse?.continuationToken || null);
      setChallengeTargetLabel(
        startResponse?.challengeTargetLabel || form.username
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
      console.error("[PasswordResetPage] Failed to start password reset", err);
      // Display errorDescription if available, otherwise fall back to message
      const errorMessage =
        err?.data?.details?.errorDescription ||
        err?.data?.error ||
        err?.message ||
        "Unable to start password reset. Please try again.";
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

    if (!form.newPassword) {
      setError("New password is required.");
      return;
    }

    if (form.newPassword !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setCorrelationId(null);

    try {
      // First verify the OTP code
      const verifyResponse = await passwordResetVerifyCode({
        continuationToken,
        code: otpCode,
      });

      if (verifyResponse?.correlationId) {
        setCorrelationId(verifyResponse.correlationId);
      }

      // Check if we need to set new password or if reset is complete
      if (verifyResponse?.status === "verify_password") {
        // Need to set new password in next step
        const nextToken =
          verifyResponse?.continuationToken || continuationToken;

        const completeResponse = await passwordResetComplete({
          continuationToken: nextToken,
          newPassword: form.newPassword,
        });

        if (completeResponse?.correlationId) {
          setCorrelationId(completeResponse.correlationId);
        }
      }

      setStep("success");
      setOtpCode("");
      setChallengeIntervalSeconds(null);
      setChallengeCodeLength(null);
      setChallengeTargetLabel(null);
      setContinuationToken(null);
    } catch (err) {
      console.error("[PasswordResetPage] Password reset failed", err);
      // Display errorDescription if available, otherwise fall back to message
      const errorMessage =
        err?.data?.details?.errorDescription ||
        err?.data?.error ||
        err?.message ||
        "Unable to complete password reset. Please try again.";
      setError(errorMessage);
      setCorrelationId(err?.data?.correlationId ?? err?.correlationId ?? null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestart = () => {
    setStep("start");
    setContinuationToken(null);
    setOtpCode("");
    setChallengeTargetLabel(null);
    setChallengeIntervalSeconds(null);
    setChallengeCodeLength(null);
    setError(null);
    setCorrelationId(null);
  };

  const handleReturnToLogin = () => {
    navigate("/auth/login", { replace: true });
  };

  const loadingMessage =
    step === "start"
      ? "Sending your verification code..."
      : "Resetting your password...";

  return (
    <section className="page page--auth">
      <div className="card card--centered">
        {step === "start" && (
          <>
            <h1>Reset your password</h1>
            <p className="muted">
              Enter your email address and we'll send you a verification code to
              reset your password.
            </p>

            <form className="auth-form" onSubmit={handleStartSubmit}>
              <div className="form-group">
                <label htmlFor="username">Work or school email</label>
                <input
                  id="username"
                  name="username"
                  type="email"
                  autoComplete="email"
                  value={form.username}
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
              Remember your password? <Link to="/auth/login">Sign in</Link>.
            </p>
          </>
        )}

        {step === "otp" && (
          <>
            <h1>Reset your password</h1>
            <p className="muted">
              We sent a verification code to{" "}
              <strong>{challengeTargetLabel || form.username}</strong>. Enter
              the code and your new password below.
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

              <div className="form-group">
                <label htmlFor="newPassword">New password</label>
                <input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={form.newPassword}
                  onChange={handleInputChange}
                  disabled={isLoading}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm new password</label>
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
                Reset password
              </button>
            </form>

            <p className="muted">
              Didn't receive a code? Check your spam folder or{" "}
              <button
                type="button"
                className="btn btn--link"
                onClick={handleRestart}
                disabled={isLoading}
              >
                restart the reset
              </button>
              .
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
            <h1>Password reset successful!</h1>
            <p className="muted">
              Your password has been updated. You can now sign in with your new
              password.
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

export default PasswordResetPage;
