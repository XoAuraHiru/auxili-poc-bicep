# Product Function App (v4)

This Functions v4 app exposes sample product APIs secured with bearer tokens issued by your native authentication flow. Both read and write operations enforce JWT signature, issuer, audience, tenant, client, role, and scope checks.

## Authorization settings

Add the following environment variables (see `local.settings.json` for placeholders):

| Setting                   | Purpose                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `AUTH_JWKS_URI`           | JWKS endpoint used to validate token signatures.                                       |
| `AUTH_ISSUER`             | Expected issuer for incoming tokens.                                                   |
| `AUTH_AUDIENCE`           | Space-/comma-separated audience values accepted by the API.                            |
| `AUTH_CLOCK_SKEW_SECONDS` | Optional clock skew allowance (default 60 seconds).                                    |
| `PRODUCT_READ_ROLES`      | Roles permitted to call `GET /products/{id}` (default `Products.Read Products.Admin`). |
| `PRODUCT_READ_SCOPES`     | Delegated scopes required for reads (default `Products.Read`).                         |
| `PRODUCT_WRITE_ROLES`     | Roles permitted to call `POST /products`.                                              |
| `PRODUCT_WRITE_SCOPES`    | Delegated scopes required for writes.                                                  |
| `PRODUCT_ALLOWED_TENANTS` | Optional tenant allow list.                                                            |
| `PRODUCT_ALLOWED_CLIENTS` | Optional client (app) allow list.                                                      |

## Running locally

```powershell
cd product-function-app-v4
npm install
func start
```

Ensure callers present a bearer token that passes the configured checks. Authorization failures return sanitized `401`/`403` responses with a correlation ID to aid troubleshooting.
