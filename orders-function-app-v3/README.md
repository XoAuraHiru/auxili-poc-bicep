# Orders Function App (v3)

This Azure Functions app exposes a simple Orders API that now requires bearer tokens issued by your Entra ID native authentication flow. The **GetOrder** endpoint enforces role- and scope-based authorization using signed JWT access tokens.

## Authorization requirements

| Setting                   | Purpose                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_JWKS_URI`           | JWKS endpoint used to validate JWT signatures (e.g. `https://{tenant}.ciamlogin.com/{tenant}.onmicrosoft.com/discovery/v2.0/keys`). |
| `AUTH_ISSUER`             | Expected token issuer (e.g. `https://{tenant}.ciamlogin.com/{tenant}.onmicrosoft.com`).                                             |
| `AUTH_AUDIENCE`           | Allowed audience / application ID URI for the API (space or comma separated for multiple audiences).                                |
| `AUTH_CLOCK_SKEW_SECONDS` | Optional leeway when validating token `exp` / `nbf` (defaults to 60 seconds).                                                       |
| `ORDERS_READ_ROLES`       | Space or comma separated roles that may access the `GetOrder` endpoint (defaults to `Orders.Read Orders.Admin`).                    |
| `ORDERS_READ_SCOPES`      | Required OAuth scopes from delegated tokens (defaults to `Orders.Read`).                                                            |
| `ORDERS_ALLOWED_TENANTS`  | Optional allow list of tenant IDs. Leave empty to accept any tenant.                                                                |
| `ORDERS_ALLOWED_CLIENTS`  | Optional allow list of client IDs (for application permissions).                                                                    |

Tokens missing the expected issuer, audience, roles, or scopes are rejected with the correct HTTP status (`401` or `403`).

## Local development

1. Install dependencies once:

   ```powershell
   cd orders-function-app-v3
   npm install
   ```

2. Update `local.settings.json` (or environment variables) with the configuration values listed above.
3. Start the function host:

   ```powershell
   func start
   ```

Send requests with an `Authorization: Bearer {token}` header that satisfies the configured roles/scopes.

## Error handling

Authorization failures return sanitized responses and log correlation-friendly details:

- `401 Unauthorized` when the token is missing or invalid
- `403 Forbidden` when the caller lacks the required role/scope, client, or tenant

Each response includes a `correlationId` so you can trace requests across services.
