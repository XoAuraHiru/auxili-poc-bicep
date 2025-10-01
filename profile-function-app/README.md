# Profile Function App

Azure Functions v4 app that surfaces authenticated profile endpoints behind API Management. The API trusts JWT enforcement performed at the APIM layer and expects enriched identity headers (such as `X-User-Object-Id`, `X-User-Principal-Name`, and `X-User-Scopes`).

## HTTP endpoints

| Operation       | Method | Route                   | Notes                                                                             |
| --------------- | ------ | ----------------------- | --------------------------------------------------------------------------------- |
| GetMyProfile    | GET    | `/api/profile/me`       | Returns the caller's profile. Requires any authenticated identity.                |
| UpdateMyProfile | PUT    | `/api/profile/me`       | Updates mutable profile fields. Requires `profile.write` (or `user.write`) scope. |
| DeleteMyProfile | DELETE | `/api/profile/me`       | Removes the profile record. Requires `profile.delete` (or `user.delete`) scope.   |
| GetUserSettings | GET    | `/api/profile/settings` | Returns stored preference data.                                                   |
| ProfileHealth   | GET    | `/api/profile/health`   | Public health probe; no auth required.                                            |

## Running locally

```powershell
cd profile-function-app
npm install
npm test
func start
```

The Functions runtime expects the headers listed above. When running behind APIM the `auth-policies` module injects them automatically. For local testing you can supply them manually via a tool such as VS Code REST Client or Postman.

## Configuration

| Setting                    | Description                                                             |
| -------------------------- | ----------------------------------------------------------------------- |
| `AzureWebJobsStorage`      | Storage connection string for the function app (set by infrastructure). |
| `FUNCTIONS_WORKER_RUNTIME` | Defaulted to `node`.                                                    |
| `NODE_ENV`                 | Populated from the deployment environment.                              |

## Testing

Unit tests exercise header parsing, validation, and the in-memory profile store. Run them with `npm test`. The mock data also seeds a sample user (`user-123`) for quick manual validation.
