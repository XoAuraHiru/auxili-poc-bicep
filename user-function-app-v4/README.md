# User Function App (v4)

This Azure Functions app hosts the authentication and profile endpoints that power the Auxili proof of concept. It now supports both the interactive OAuth redirect flow **and** an opt-in Resource Owner Password Credentials (ROPC) flow that signs users in with their Entra ID email and password via the `/auth/password` endpoint.

> ⚠️ **Important:** The ROPC grant is disabled for most tenants and is _not_ recommended for personal Microsoft accounts or users forced to satisfy MFA. Only enable it for trusted, first-party scenarios after reviewing Microsoft's security guidance.

## Required configuration

All configuration is injected via environment variables (local `local.settings.json` or Azure Function App application settings).

| Setting                | Purpose                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `CLIENT_REDIRECT_URI`  | SPA callback URI (e.g. `http://localhost:3000/auth/callback`).                                                    |
| `SERVER_REDIRECT_URI`  | Function App callback URI registered in Entra ID (e.g. `https://<function-app>.azurewebsites.net/auth/callback`). |
| `ENTRA_TENANT_ID`      | Entra tenant ID. Defaults to the demo tenant if omitted.                                                          |
| `ENTRA_CLIENT_ID`      | Client ID used by the interactive flow. Defaults to the demo app registration.                                    |
| `ENTRA_CLIENT_SECRET`  | Client secret for confidential client flows (optional for public clients).                                        |
| `ENTRA_AUTHORITY`      | Base authority URL. Defaults to `https://login.microsoftonline.com/{ENTRA_TENANT_ID}`.                            |
| `ENTRA_AUTH_SCOPES`    | Space- or comma-separated scopes requested during the interactive flow. Defaults to `openid profile email`.       |
| `ENTRA_TOKEN_SCOPES`   | Scopes exchanged during the auth-code flow. Defaults to `ENTRA_AUTH_SCOPES offline_access`.                       |
| `ENTRA_ROPC_CLIENT_ID` | Client ID used for the ROPC flow. Falls back to `ENTRA_CLIENT_ID` if not provided.                                |
| `ENTRA_ROPC_AUTHORITY` | Authority for the ROPC flow. Falls back to `ENTRA_AUTHORITY`.                                                     |
| `ENTRA_ROPC_SCOPES`    | Scopes requested when calling `acquireTokenByUsernamePassword`. Defaults to `ENTRA_TOKEN_SCOPES`.                 |

For local development, update `local.settings.json`:

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "CLIENT_REDIRECT_URI": "http://localhost:3000/auth/callback",
    "SERVER_REDIRECT_URI": "https://<function-app>.azurewebsites.net/auth/callback",
    "ENTRA_TENANT_ID": "<your-tenant-id>",
    "ENTRA_CLIENT_ID": "<interactive-client-id>",
    "ENTRA_CLIENT_SECRET": "<client-secret-if-required>",
    "ENTRA_AUTHORITY": "https://login.microsoftonline.com/<your-tenant-id>",
    "ENTRA_AUTH_SCOPES": "openid profile email",
    "ENTRA_TOKEN_SCOPES": "openid profile email offline_access",
    "ENTRA_ROPC_CLIENT_ID": "<ropc-client-id-if-different>",
    "ENTRA_ROPC_AUTHORITY": "https://login.microsoftonline.com/<your-tenant-id>",
    "ENTRA_ROPC_SCOPES": "openid profile email offline_access"
  }
}
```

## Enabling the ROPC flow

1. **App registration:** Use a confidential or public client app that has the desired API permissions. If you reuse the interactive client, ensure "Allow public client flows" is enabled.
2. **Grant permissions:** For Microsoft Graph or custom API scopes, grant admin consent so the ROPC flow can succeed without prompting the user.
3. **Disable MFA for test accounts:** ROPC does not support interactive MFA. Use dedicated test accounts that meet your organisation's security policies.
4. **Update application settings:** Populate the `ENTRA_ROPC_*` variables (and secret if the client is confidential) in both local and Azure environments.

Once configured, the `/auth/password` endpoint returns the same payload shape as the interactive `/auth/callback`, enabling the React client to store and reuse the tokens transparently.
