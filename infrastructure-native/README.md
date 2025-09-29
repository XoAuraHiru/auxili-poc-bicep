# Native Auth Infrastructure & APIM Security Guide

This guide walks through the standalone Bicep assets under `infrastructure-native/`, outlines the API Management (APIM) security policies, and captures the deployment steps for each environment.

## 1. Architecture at a Glance

- **Function apps**: `native-auth-function-app`, `product-function-app-v4`, `user-function-app-v4`, and `orders-function-app-v3` expose HTTPS endpoints secured by APIM.
- **API Management gateway**: Fronts every function app, applies JWT validation, injects the Azure Functions host keys, enforces rate limiting, and normalises headers for downstream services.
- **Entra ID (Azure AD)**: Issues access tokens for the native clients. The application ID, tenant ID, issuer, and JWKS endpoint feed directly into the policy module.
- **Bicep modules** located in `infrastructure-native/modules/`:
  - `auth-policies.bicep` – produces reusable policy XML fragments for protected vs. public APIs.
  - `apim.bicep` – provisions the dedicated API Management instance with baseline global policies.
  - `native-auth-apim.bicep` – defines the native auth API surface and consumes the shared policy outputs.
  - `function-app.bicep`, `storage.bicep`, `app-insights.bicep` – supporting resources for the function workload.
  - `main.bicep` – environment-specific entry point that wires all modules together and invokes `auth-policies.bicep` for this standalone slice.

> The shared `infrastructure/main.bicep` can still orchestrate the wider platform. Use `infrastructure-native/main.bicep` when you want to deploy only the native-auth footprint.

## 2. Policy Behaviour (`modules/auth-policies.bicep`)

| Feature             | Description                                                                                                                         | Notes                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JWT validation      | Enforces bearer tokens on protected endpoints using `<validate-jwt>` with issuer discovery via `/.well-known/openid-configuration`. | Accepts the primary app ID plus optional `additionalAudiences`. Scoped claims (`scp`/`scope`) and app roles (`roles`) can be required per environment. |
| Rate limiting       | `<rate-limit>` limits requests per subscription or key (default: 120 calls / 60 seconds).                                           | Tunable using `rateLimitCalls` and `rateLimitRenewalSeconds`.                                                                                          |
| CORS                | Allows fine-grained origins. Dev environments keep `http://localhost:3000` enabled automatically.                                   | Override `allowedOrigins` for additional hosts.                                                                                                        |
| Security headers    | Adds outbound headers: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, and `Referrer-Policy`.             | Ensures browser-facing responses meet minimum hardening.                                                                                               |
| Context propagation | Injects user claims (`oid`, `preferred_username`, `scp`) and `X-Correlation-Id` headers to the backend.                             | Downstream functions can rely on these headers without parsing JWTs again.                                                                             |
| Environment tagging | Adds `X-Environment` inbound header so logging / diagnostics can segment traffic.                                                   | Uses the `environment` parameter passed from the root template.                                                                                        |
| Dev bypass          | When `enableAuth` is `false`, a relaxed policy injects a fake identity, removes JWT validation, but keeps CORS and throttling.      | Useful for local demos without Entra ID setup.                                                                                                         |

Outputs:

- `protectedApiPolicy`: Multi-line XML string for secured APIs.
- `publicApiPolicy`: XML for unauthenticated endpoints (e.g. sign-in, health checks).
- `authenticationEnabled`: Mirrors the `enableAuth` parameter for downstream logic.

## 3. API Wiring (`modules/native-auth-apim.bicep`)

Key responsibilities:

1. **Creates/updates the native auth API** with explicit operations so deployments remain idempotent.
2. **Injects Function App keys**: The module resolves the function app’s default host key and interpolates it into the `<set-header name="x-functions-key">` block using `replace()`.
3. **Applies scoped policies**: The API receives the `publicApiPolicy` template (with function-key injection) so sign-in flows stay open while still applying rate limits, CORS, and security headers.
4. **Environment-aware subscription requirement**: `subscriptionRequired` remains disabled because native flows are anonymous by design.

### Standalone slice (`main.bicep`)

- Calls `modules/auth-policies.bicep`, reusing the same rate limiting, header normalisation, and CORS logic as the shared template.
- Toggling `enableAuth` swaps the underlying policy between the strict JWT version and the relaxed development stub without touching the APIM XML manually.

## 4. Parameters & Secrets

| Parameter                                   | Source                                                                        | Purpose                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `applicationId`                             | Output of `modules/entra-id-app.bicep` or manual client registration          | Primary audience for JWT validation.                                                       |
| `tenantId`                                  | `tenant().tenantId` output                                                    | Drives issuer and JWKS URIs when not overridden.                                           |
| `issuerUrl`, `jwksUri`                      | Default to global cloud endpoints and can be overridden for sovereign clouds. |
| `additionalAudiences`                       | Optional list                                                                 | Supports multiple audiences (e.g. downstream APIs, SPA).                                   |
| `requiredScopes` / `requiredRoles`          | Arrays                                                                        | Define the scopes or app roles that must be present on the token before access is granted. |
| `allowedOrigins`                            | Array (defaults differ for dev vs. non-dev)                                   | Tailor to front-end base URLs per environment.                                             |
| `enableAuth`                                | Boolean                                                                       | Switches between strict JWT enforcement and developer mode bypass.                         |
| `rateLimitCalls`, `rateLimitRenewalSeconds` | Integers                                                                      | Throttling configuration consumed by APIM.                                                 |

> The table above now applies to both `infrastructure/main.bicep` and the standalone `infrastructure-native/main.bicep`. When deploying the native auth slice independently, add these parameters to `infrastructure-native/parameters/<env>.parameters.json` as needed. For example:

```json
   "enableAuth": {
      "value": true
   },
   "applicationId": {
      "value": "<entra-client-id>"
   },
   "allowedOrigins": {
      "value": [
         "https://your-app.contoso.com"
      ]
   }
```

Secrets such as Entra ID client secrets, native auth keys, or Function App host keys are never hard-coded. The deployment uses ARM’s `listKeys()` at runtime, and application settings should be managed via `az functionapp config appsettings set` or pipeline secrets.

## 5. Deployment Steps

> All commands assume the repository root as the working directory and Azure CLI `>= 2.53`. Replace names with the environment you are targeting (`dev`, `staging`, `prod`).

1. **Provision / update the resource group**:

   ```powershell
   az group create -n rg-auxili-poc-v2-dev -l "Southeast Asia"
   ```

2. **Deploy the shared infrastructure (APIM, storage, app insights, etc.)**:

   ```powershell
   az deployment group create \
     -g rg-auxili-poc-v2-dev \
     -f infrastructure/main.bicep \
     -p @infrastructure/parameters/dev.parameters.json
   ```

3. **Deploy the native-auth slice (standalone)**:

   ```powershell
   az deployment group create \
     -g rg-auxili-poc-v2-dev \
     -f infrastructure-native/main.bicep \
     -p @infrastructure-native/parameters/dev.parameters.json
   ```

   Populate the parameter file with `enableAuth`, `applicationId`, `tenantId` (if different from the current directory), and any custom `allowedOrigins` or scope requirements before running this command for secured environments.

4. **Publish function apps** (repeat per service):

   ```powershell
   cd native-auth-function-app
   func azure functionapp publish func-auxili-nat-dev-oy7oll
   cd ..

   cd user-function-app-v4
   func azure functionapp publish func-auxili-user-dev-ad7stftg
   cd ..

   cd product-function-app-v4
   func azure functionapp publish func-auxili-product-dev-ad7stftg
   cd ..
   ```

5. **Configure application settings** for each function app to align with Entra ID and native auth:

   ```powershell
   az functionapp config appsettings set \
     --name func-auxili-user-dev-ad7stftg \
     --resource-group rg-auxili-poc-v2-dev \
     --settings \
       NATIVE_AUTH_ENABLED=true \
       NATIVE_AUTH_CLIENT_ID=<application-id> \
       NATIVE_AUTH_TENANT_SUBDOMAIN=<tenant-subdomain> \
       NATIVE_AUTH_SCOPES="openid profile email offline_access"
   ```

6. **Re-run the infrastructure deployment** whenever policies or operations change so APIM receives the latest configuration.

## 6. Verification Checklist

- Run `bicep build infrastructure-native/main.bicep` locally to confirm template validity.
- After deployment, inspect APIM > APIs > _Native Auth_ > **Inbound processing** to verify the injected policy and host key.
- Exercise authentication flows using the sample clients under `ms-identity-ciam-native-javascript-samples/` to ensure CORS and JWT requirements align with the environment.
- For non-production, set `enableAuth` to `false` in the parameter file to bypass JWT while keeping rate-limits and headers in place.

## 7. Next Steps

- Introduce per-operation scopes by supplying distinct `requiredScopes` arrays when calling the policy module per API.
- Automate function app deployment using GitHub Actions or Azure DevOps, referencing the CLI commands above.
- Extend logging by consuming the injected headers (`X-Environment`, `X-Correlation-Id`) within the function apps for richer telemetry.

---

This document should be revisited whenever new APIs are added or when authorization requirements (scopes, roles, rate limits) change.
