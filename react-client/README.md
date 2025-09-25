## Auxili React Client

This Vite-powered React application showcases how our microservices platform authenticates users with **Azure Entra ID** and calls protected endpoints that are exposed through **Azure Functions** and **API Management**. It is designed as a companion UI for the function apps in this repository.

### Features

- Microsoft sign-in flow driven by the `/auth` function endpoints
- Secure token storage with automatic state validation during the OAuth callback
- Context-driven auth state (`AuthProvider`) shared across the app
- One-click calls to:
  - `GET /auth/me`
  - `GET /auth/keepalive`
  - `POST /auth/validate`
  - `GET /users`
  - `GET /products`
- Optional support for API Management subscription keys
- Clean layout with helpful diagnostics and copy-friendly token previews

### Prerequisites

- Node.js 18+ (20+ recommended)
- Access to the Azure resources provisioned by this repo (or equivalent Function Apps/APIM endpoints)

### Quick start

```powershell
cd "c:\Users\HIRUN\Documents\My Personal Projects\auxili-poc-bicep\react-client"
copy .env.example .env.local
# edit .env.local with your API base URL and optional subscription key
npm install
npm run dev
```

The dev server is pinned to **http://localhost:3000** so it matches the redirect URI configured in the Azure Functions. When you sign in, you’ll be returned to `/auth/callback`, where the tokens are exchanged and stored.

### Environment variables

| Variable                     | Purpose                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`          | Base URL for your API Management gateway or direct Function App host. Example: `https://apim-auxili-dev-ad7stftg.azure-api.net`. |
| `VITE_APIM_SUBSCRIPTION_KEY` | Optional subscription key automatically attached to every request (`Ocp-Apim-Subscription-Key`).                                 |
| `VITE_ENTRA_TENANT_ID`       | (Optional) Display value on the login screen; the backend already knows about it.                                                |
| `VITE_ENTRA_CLIENT_ID`       | (Optional) Display value on the login screen.                                                                                    |

Create a `.env.local` (ignored by git) and populate the values that differ from the defaults.

### Available scripts

```powershell
npm run dev     # Local development with hot reload on port 3000
npm run build   # Production build (outputs to dist/)
npm run lint    # ESLint using the repo's shared config
```

### How it works

1. **Login** – `POST /auth/signin` returns the Entra authorization URL. We stash the state in `sessionStorage` before redirecting the browser to Microsoft.
2. **Callback** – `/auth/callback` is invoked from the SPA route to exchange the auth code for tokens. The results populate the auth context and localStorage.
3. **Protected calls** – Buttons on the dashboard attach the Bearer token and (optionally) the APIM subscription key before calling Function App endpoints.
4. **Keep alive / Validate** – Demonstrates the supporting auth endpoints to confirm the session is still valid.

You can customise the UI or plug additional APIs into the shared `apiClient` located at `src/services/apiClient.js`.

### Troubleshooting

- Make sure your redirect URI in Entra ID matches `http://localhost:3000/auth/callback` (or update both Vite and the Entra app registration).
- If APIM requires a subscription key, set `VITE_APIM_SUBSCRIPTION_KEY` or you’ll receive `401` responses.
- CORS errors usually indicate that the Function App or APIM service hasn’t been updated to allow `http://localhost:3000`.

Happy building! 🎉
