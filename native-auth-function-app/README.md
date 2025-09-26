# Native Auth Function App

This Azure Functions app exposes a Microsoft Entra native authentication experience with modular building blocks for sign-in, sign-up, and password reset flows.

## Project structure

```
src/
  clients/               # HTTP client for Microsoft Entra native auth endpoints
  config/                # Environment-driven configuration helpers
  errors/                # Custom error types shared across services
  functions/             # Azure Function entry points (lightweight orchestrators)
  normalizers/           # Request payload normalizers
  services/              # Business logic for each authentication flow
  utils/                 # Generic helpers (logging, JWT helpers, etc.)
  validation/            # AJV schemas and compiled validators
```

Each HTTP-triggered function remains focused on:

- Setting up correlation IDs and structured logging
- Parsing and validating incoming payloads
- Delegating business logic to the services layer
- Normalising errors before returning consistent JSON responses

## Local development

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Start the Azure Functions runtime:

   ```powershell
   npm start
   ```

   The script runs `func start --javascript`, so ensure the Azure Functions Core Tools are installed locally.

3. Useful environment settings (configure in `local.settings.json` or Azure configuration):

   - `NATIVE_AUTH_CLIENT_ID`
   - `NATIVE_AUTH_TENANT_SUBDOMAIN` or `NATIVE_AUTH_BASE_URL`
   - `NATIVE_AUTH_SCOPES`
   - Optional challenge and attribute customisation variables:
     - `NATIVE_AUTH_CHALLENGE_TYPES`
     - `NATIVE_AUTH_SIGNUP_CHALLENGE_TYPES`
     - `NATIVE_AUTH_SIGNUP_ATTRIBUTE_MAP`
     - `NATIVE_AUTH_SIGNUP_STATIC_ATTRIBUTES`

## Testing & quality

A placeholder `npm test` script is provided. Extend it with unit or integration tests as needed. After changes, you can run:

```powershell
npm run build
npm test
```

## OTP delivery flow

- `POST /auth/signup/start` now triggers both the `/signup/v1.0/start` and `/signup/v1.0/challenge` Microsoft Entra calls. The function returns challenge metadata (channel, interval, obfuscated email) and a refreshed continuation token once the email OTP has been issued.
- `POST /auth/password/reset/start` behaves the same way for the password reset flow by chaining `/resetpassword/v1.0/start` and `/resetpassword/v1.0/challenge`.
- To resend a verification code, call the dedicated relays:
  - `POST /auth/signup/challenge` with the latest continuation token.
  - `POST /auth/password/reset/challenge` (future enhancement) or restart the reset flow.

Each response includes `challengeIntervalSeconds` and `codeLength` hints so the client can respect Azure throttling guidance before attempting a resend.

## Deployment

Publish to Azure using the existing script:

```powershell
npm run deploy
```

This command wraps `func azure functionapp publish` so you can provide the target Function App name or configure it via the Azure Functions Core Tools prompt.
