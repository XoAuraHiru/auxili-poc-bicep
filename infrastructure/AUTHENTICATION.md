# Azure Entra ID Authentication Implementation

This document describes the Azure Entra ID authentication implementation for the auxili-poc-bicep microservices architecture, similar to AWS Cognito functionality.

## Overview

The authentication system consists of:

1. **Azure Entra ID App Registration** - Identity provider (similar to AWS Cognito User Pool)
2. **API Management JWT Policies** - Token validation at the gateway level
3. **Function App Integration** - Secure backend services
4. **Environment-specific Configuration** - Different auth settings per environment

## Architecture

```
Client Application
        ↓ (OAuth2/OpenID Connect)
Azure Entra ID (Identity Provider)
        ↓ (JWT Access Token)
API Management (Token Validation)
        ↓ (Authenticated Requests + Function Keys)
Azure Function Apps (Backend Services)
```

## Environment Configuration

| Environment | Authentication | APIM SKU    | Description                                     |
| ----------- | -------------- | ----------- | ----------------------------------------------- |
| **dev**     | Disabled       | Consumption | Development environment with no auth required   |
| **staging** | Enabled        | Developer   | Testing environment with full authentication    |
| **prod**    | Enabled        | Standard    | Production environment with enterprise features |

## Setup Instructions

### 1. Create Entra ID App Registration

Run the PowerShell script to create the app registration:

```powershell
# Navigate to scripts directory
cd infrastructure/scripts

# Create app registration for development
./create-entra-app.ps1 -AppName "rg-auxili-poc-v2-dev" -Environment "dev"

# Create app registration for staging
./create-entra-app.ps1 -AppName "rg-auxili-poc-v2-dev" -Environment "staging"

# Create app registration for production
./create-entra-app.ps1 -AppName "rg-auxili-poc-v2-dev" -Environment "prod"
```

### 2. Update Parameter Files

Update the `entraAppId` parameter in each environment's parameter file with the Application ID from step 1:

- `parameters/dev.parameters.json`
- `parameters/staging.parameters.json`
- `parameters/prod.parameters.json`

### 3. Deploy Infrastructure

```bash
# Deploy to development (no authentication)
az deployment group create \
  --resource-group rg-auxili-dev \
  --template-file main.bicep \
  --parameters @parameters/dev.parameters.json

# Deploy to staging (with authentication)
az deployment group create \
  --resource-group rg-auxili-staging \
  --template-file main.bicep \
  --parameters @parameters/staging.parameters.json

# Deploy to production (with authentication)
az deployment group create \
  --resource-group rg-auxili-prod \
  --template-file main.bicep \
  --parameters @parameters/prod.parameters.json
```

## Authentication Flow

### 1. Client Authentication (OAuth2 Authorization Code Flow)

```javascript
// Client-side authentication example
const authConfig = {
  clientId: "your-app-registration-id",
  authority: "https://login.microsoftonline.com/your-tenant-id",
  redirectUri: "http://localhost:3000",
  scopes: ["openid", "profile", "email"],
};

// Use MSAL.js or similar library
const msalInstance = new msal.PublicClientApplication(authConfig);
```

### 2. API Calls with Bearer Token

```javascript
// Get access token
const tokenResponse = await msalInstance.acquireTokenSilent({
  scopes: [
    "https://your-tenant.onmicrosoft.com/auxili-microservices-api/API.Access",
  ],
  account: account,
});

// Make authenticated API call
const response = await fetch(
  "https://your-apim-gateway.azure-api.net/products/123",
  {
    headers: {
      Authorization: `Bearer ${tokenResponse.accessToken}`,
      "Content-Type": "application/json",
    },
  }
);
```

## API Endpoints

### Protected Endpoints (Require Authentication)

- `GET /products/{id}` - Get specific product
- `POST /products` - Create new product
- `GET /users/{id}` - Get specific user
- `POST /users` - Create new user
- `GET /users` - List all users
- `GET /orders/{id}` - Get specific order

### Public Endpoints (No Authentication Required)

- `GET /products/health` - Product service health check
- `GET /users/health` - User service health check
- `GET /orders/health` - Orders service health check

## Security Features

### JWT Token Validation

- **Issuer Validation**: Ensures tokens come from your Azure AD tenant
- **Audience Validation**: Verifies tokens are intended for your API
- **Signature Validation**: Uses JWKS endpoint for token signature verification
- **Claims Extraction**: Extracts user information from JWT payload

### API Management Policies

- **Rate Limiting**: Per-user rate limiting (1000 calls/hour for authenticated users)
- **CORS**: Configured for browser-based applications
- **Security Headers**: Adds security headers to responses
- **User Context**: Passes user ID to backend services via X-User-Id header

### Function App Security

- **Function Keys**: Automatic injection of function keys for backend authentication
- **User Context**: Receives user ID from APIM for authorization decisions

## Testing the Authentication

### 1. Using Postman

1. Set up OAuth2 authentication in Postman:

   - **Authorization URL**: `https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/authorize`
   - **Access Token URL**: `https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token`
   - **Client ID**: Your app registration ID
   - **Scope**: `openid profile https://{tenant}.onmicrosoft.com/{app-name}/API.Access`

2. Get access token and make requests to protected endpoints

### 2. Using cURL

```bash
# Get access token (requires manual browser authentication)
# Or use client credentials flow for service-to-service auth

# Make authenticated request
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     https://your-apim-gateway.azure-api.net/products/123
```

### 3. Testing Health Endpoints (No Auth Required)

```bash
# These should work without authentication
curl https://your-apim-gateway.azure-api.net/products/health
curl https://your-apim-gateway.azure-api.net/users/health
curl https://your-apim-gateway.azure-api.net/orders/health
```

## Troubleshooting

### Common Issues

1. **401 Unauthorized**

   - Check if the Bearer token is included in the Authorization header
   - Verify token hasn't expired
   - Ensure the audience claim matches your application ID

2. **Token Validation Errors**

   - Verify the issuer URL in the JWT policy matches your tenant
   - Check that the JWKS URI is accessible
   - Ensure the app registration is properly configured

3. **CORS Issues**
   - Add your client domain to the allowed origins in the CORS policy
   - Ensure preflight OPTIONS requests are handled

### Debugging

1. **Enable APIM Tracing**: Add `Ocp-Apim-Trace: true` header to requests
2. **Check Application Insights**: Monitor authentication failures and errors
3. **JWT Debugging**: Use [jwt.io](https://jwt.io) to decode and inspect tokens

## Security Best Practices

1. **Token Storage**: Store tokens securely (use httpOnly cookies or secure storage)
2. **Token Expiration**: Implement token refresh logic
3. **Scopes**: Use minimal required scopes
4. **Rate Limiting**: Monitor and adjust rate limits based on usage
5. **Logging**: Log authentication events for security monitoring

## Comparison with AWS Cognito

| Feature               | AWS Cognito                   | Azure Entra ID             |
| --------------------- | ----------------------------- | -------------------------- |
| **Identity Provider** | Cognito User Pool             | Entra ID App Registration  |
| **Token Type**        | JWT                           | JWT                        |
| **Token Validation**  | API Gateway Custom Authorizer | APIM JWT Validation Policy |
| **User Management**   | Cognito Console/SDK           | Azure Portal/Graph API     |
| **Social Login**      | Built-in                      | Built-in                   |
| **MFA**               | Built-in                      | Built-in                   |
| **Token Refresh**     | Refresh Token                 | Refresh Token              |

## Next Steps

1. **User Management**: Implement user registration and profile management
2. **Role-Based Access**: Add role-based authorization using Azure AD groups or app roles
3. **Social Login**: Configure social identity providers (Google, Facebook, etc.)
4. **Multi-Factor Authentication**: Enable MFA requirements
5. **Monitoring**: Set up authentication metrics and alerting

## Resources

- [Azure Entra ID Documentation](https://docs.microsoft.com/en-us/azure/active-directory/)
- [API Management JWT Validation](https://docs.microsoft.com/en-us/azure/api-management/api-management-access-restriction-policies#ValidateJWT)
- [MSAL.js Documentation](https://docs.microsoft.com/en-us/azure/active-directory/develop/msal-js-initializing-client-applications)
- [OAuth2 Authorization Code Flow](https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow)
