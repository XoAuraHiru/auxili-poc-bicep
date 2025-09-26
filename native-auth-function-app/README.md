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

## Deployment

Publish to Azure using the existing script:

```powershell
npm run deploy
```

This command wraps `func azure functionapp publish` so you can provide the target Function App name or configure it via the Azure Functions Core Tools prompt.
