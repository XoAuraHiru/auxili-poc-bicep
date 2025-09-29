# Native Auth Function App

This Azure Functions app exposes a Microsoft Entra native authentication experience with modular building blocks for sign-in, sign-up, and password reset flows.

## Project structure

```
src/
  core/                  # Shared orchestrators for password/sign-up/reset flows
  clients/               # HTTP client for Microsoft Entra native auth endpoints
  config/                # Environment-driven configuration helpers
  errors/                # Custom error types shared across services
  functions/             # Azure Function entry points (lightweight orchestrators)
  normalizers/           # Request payload normalizers
  services/              # Business logic for each authentication flow
  utils/                 # Generic helpers (logging, correlation IDs, etc.)
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

- `POST /auth/signup/start` chains `/signup/v1.0/start` and `/signup/v1.0/challenge`, returning challenge metadata (channel, interval, obfuscated email) plus the refreshed continuation token after issuing the OTP email.
- `POST /auth/password/reset/start` performs the equivalent sequence for password reset by invoking `/resetpassword/v1.0/start` and `/resetpassword/v1.0/challenge`.
- To resend a code, call the corresponding `start` endpoint again with the same identifier; Microsoft Entra will enforce throttling and the response still surfaces `challengeIntervalSeconds` and `codeLength` so clients can respect retry guidance.

## Deployment

Publish to Azure using the existing script:

```powershell
npm run deploy
```

This command wraps `func azure functionapp publish` so you can provide the target Function App name or configure it via the Azure Functions Core Tools prompt.
