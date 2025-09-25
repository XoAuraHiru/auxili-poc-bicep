import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import LoadingOverlay from '../components/LoadingOverlay.jsx'
import { requestAuthUrl } from '../services/authApi.js'
import { getApiBaseUrl } from '../services/apiClient.js'

function LoginPage() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const location = useLocation()
  const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID || 'Not set'
  const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID || 'Not set'
  const hasSubscriptionKey = Boolean(import.meta.env.VITE_APIM_SUBSCRIPTION_KEY)

  const handleSignIn = async () => {
    try {
      setError(null)
      setIsSubmitting(true)
      const response = await requestAuthUrl()
      if (!response?.authUrl) {
        throw new Error('API did not return an authUrl. Check backend configuration.')
      }
      window.location.assign(response.authUrl)
    } catch (err) {
      console.error('[LoginPage] Sign-in failed', err)
      setError(err.message || 'Unable to start sign-in flow')
      setIsSubmitting(false)
    }
  }

  return (
    <section className="page page--auth">
      <div className="card card--centered">
        <h1>Sign in to Auxili</h1>
        <p className="muted">
          This demo uses Azure Entra ID via our Azure Functions `/auth` endpoints.
          Clicking the button below will redirect you to Microsoft for authentication.
        </p>

        <div className="info-panel">
          <h2>Environment</h2>
          <dl>
            <dt>API Base URL</dt>
            <dd>{getApiBaseUrl() || <span className="badge badge--warning">Not configured</span>}</dd>
            <dt>Entra client ID</dt>
            <dd className="mono">{clientId}</dd>
            <dt>Tenant ID</dt>
            <dd className="mono">{tenantId}</dd>
            <dt>APIM subscription key</dt>
            <dd>{hasSubscriptionKey ? 'Configured' : <span className="badge badge--warning">Not configured</span>}</dd>
            <dt>After sign-in</dt>
            <dd>You&apos;ll be redirected to `/auth/callback` and brought back to {location.state?.from?.pathname || 'the dashboard'}.</dd>
          </dl>
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleSignIn}
            disabled={isSubmitting}
          >
            Sign in with Microsoft
          </button>
        </div>

        {isSubmitting && <LoadingOverlay message="Redirecting to Azure Entra ID..." />}

        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}

        <div className="hint">
          <p className="muted">Demo account: <code>demo@auxili.com</code> / <code>password123</code></p>
        </div>
      </div>
    </section>
  )
}

export default LoginPage
