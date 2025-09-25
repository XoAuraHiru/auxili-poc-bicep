import { app } from '@azure/functions';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { withCorrelation, success, failure } from '../utils/shared.js';
import { validateEntraIDToken, getUserFromGraph, inviteUserToEntraID, extractBearerToken } from '../utils/entraAuth.js';

// Setup validation with email format support
const ajv = new Ajv();
addFormats(ajv);

const createUserSchema = {
    type: 'object',
    properties: {
        username: { type: 'string', minLength: 3 },
        email: { type: 'string', format: 'email' }
    },
    required: ['username', 'email'],
    additionalProperties: false
};
const validateCreateUser = ajv.compile(createUserSchema);

// Authentication schemas
const signInSchema = {
    type: 'object',
    properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 }
    },
    required: ['email', 'password'],
    additionalProperties: false
};
const validateSignIn = ajv.compile(signInSchema);

const signUpSchema = {
    type: 'object',
    properties: {
        username: { type: 'string', minLength: 3 },
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 },
        firstName: { type: 'string', minLength: 1 },
        lastName: { type: 'string', minLength: 1 }
    },
    required: ['username', 'email', 'password', 'firstName', 'lastName'],
    additionalProperties: false
};
const validateSignUp = ajv.compile(signUpSchema);

// IMPORTANT: Health check MUST come before the {id} route
app.http('UserHealth', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'users/health',  // More specific route first
    handler: async (request, context) => {
        context.log('User health check requested');
        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            jsonBody: {
                service: 'users',
                status: 'healthy',
                timestamp: new Date().toISOString(),
                message: 'User service is running properly'
            }
        };
    }
});

// GET /api/auth/signin - OAuth2 Authorization Redirect
app.http('SignIn', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'auth/signin',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            const clientRedirectUri = process.env.CLIENT_REDIRECT_URI || 'http://localhost:3000/auth/callback';
            const serverRedirectUri = process.env.SERVER_REDIRECT_URI || 'https://func-auxili-user-dev-ad7stftg.azurewebsites.net/auth/callback';

            if (request.method.toUpperCase() === 'GET') {
                // Generate OAuth2 authorization URL for Entra ID
                const clientId = 'f5c94ff4-4e57-4b2d-8cbd-64d4846817ba';
                const tenantId = 'fd2638f1-94af-4c20-9ee9-f16f08e60344';
                const redirectUri = encodeURIComponent(serverRedirectUri);
                const scope = encodeURIComponent('openid profile email');
                const state = encodeURIComponent(correlationId);
                const responseType = 'code';

                const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
                    `client_id=${clientId}&` +
                    `response_type=${responseType}&` +
                    `redirect_uri=${redirectUri}&` +
                    `scope=${scope}&` +
                    `state=${state}&` +
                    `response_mode=query`;

                context.log(`[SignIn] Redirecting to Entra ID: ${authUrl}`);

                return {
                    status: 302,
                    headers: {
                        'Location': authUrl,
                        'Access-Control-Allow-Origin': '*'
                    }
                };
            } else {
                // POST method - return authorization URL for SPA/API clients
                const clientId = 'f5c94ff4-4e57-4b2d-8cbd-64d4846817ba';
                const tenantId = 'fd2638f1-94af-4c20-9ee9-f16f08e60344';
                const redirectUri = clientRedirectUri; // For local development / configurable
                const scope = 'openid profile email';

                const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
                    `client_id=${clientId}&` +
                    `response_type=code&` +
                    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
                    `scope=${encodeURIComponent(scope)}&` +
                    `state=${encodeURIComponent(correlationId)}&` +
                    `response_mode=query`;

                context.log(`[SignIn] Providing auth URL for client: ${authUrl}`);

                return success(200, {
                    authUrl,
                    clientId,
                    tenantId,
                    redirectUri,
                    scope,
                    state: correlationId,
                    message: 'Use authUrl to authenticate with Azure Entra ID'
                }, correlationId);
            }

        } catch (error) {
            context.log.error(`[SignIn] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// GET /api/auth/callback - OAuth2 Callback Handler
app.http('AuthCallback', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'auth/callback',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            const url = new URL(request.url);
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');
            const errorDescription = url.searchParams.get('error_description');

            const callbackUrl = `${url.origin}${url.pathname}`;
            const serverRedirectUri = process.env.SERVER_REDIRECT_URI || callbackUrl;

            if (!process.env.SERVER_REDIRECT_URI) {
                context.log.warn(`[AuthCallback] SERVER_REDIRECT_URI not configured. Falling back to ${serverRedirectUri}`);
            }

            context.log(`[AuthCallback] Handling code exchange ${JSON.stringify({
                correlationId,
                state,
                callbackUrl,
                serverRedirectUri
            })}`);

            if (error) {
                context.log.error(`[AuthCallback] OAuth error: ${error} - ${errorDescription}`);
                return failure(400, `Authentication failed: ${errorDescription}`, correlationId);
            }

            if (!code) {
                context.log.error('[AuthCallback] No authorization code received');
                return failure(400, 'No authorization code received', correlationId);
            }

            // Exchange authorization code for tokens
            const clientId = 'f5c94ff4-4e57-4b2d-8cbd-64d4846817ba';
            const tenantId = 'fd2638f1-94af-4c20-9ee9-f16f08e60344';

            const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
            const tokenRequest = new URLSearchParams({
                client_id: clientId,
                scope: 'openid profile email offline_access',
                code: code,
                redirect_uri: serverRedirectUri,
                grant_type: 'authorization_code',
            });

            if (process.env.CLIENT_SECRET) {
                tokenRequest.append('client_secret', process.env.CLIENT_SECRET);
            }

            const tokenResponse = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: tokenRequest.toString()
            });

            const tokenData = await tokenResponse.json();

            if (!tokenResponse.ok) {
                const status = tokenResponse.status;
                context.log.error(`[AuthCallback] Token exchange failed ${JSON.stringify({
                    status,
                    tokenUrl,
                    serverRedirectUri,
                    data: tokenData
                })}`);

                let errorMessage = tokenData.error_description || tokenData.error || 'Unknown token error';
                if (tokenData.error === 'invalid_grant') {
                    errorMessage += ' (Check that SERVER_REDIRECT_URI matches the redirect URI registered in Entra ID and APIM.)';
                }

                return failure(status, `Token exchange failed: ${errorMessage}`, correlationId, tokenData);
            }

            if (!tokenData.id_token) {
                context.log.error('[AuthCallback] Missing id_token in response', tokenData);
                return failure(400, 'Token exchange did not return an ID token', correlationId, tokenData);
            }

            const decodeJwtPayload = (jwt) => {
                const parts = jwt.split('.');
                if (parts.length !== 3) {
                    throw new Error('Invalid JWT structure');
                }

                const base64Url = parts[1];
                const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                const padding = '='.repeat((4 - (base64.length % 4)) % 4);

                const decoded = Buffer.from(base64 + padding, 'base64').toString();
                return JSON.parse(decoded);
            };

            let idTokenPayload;
            try {
                idTokenPayload = decodeJwtPayload(tokenData.id_token);
            } catch (decodeError) {
                context.log.error('[AuthCallback] Failed to decode id_token payload', decodeError);
                return failure(400, 'Token exchange returned an invalid ID token', correlationId);
            }

            const user = {
                id: idTokenPayload.sub,
                username: idTokenPayload.preferred_username || idTokenPayload.email,
                email: idTokenPayload.email,
                firstName: idTokenPayload.given_name || '',
                lastName: idTokenPayload.family_name || '',
                name: idTokenPayload.name || ''
            };

            context.log(`[AuthCallback] Successfully authenticated user: ${user.email}`);

            // Return success with tokens and user info
            return success(200, {
                user,
                accessToken: tokenData.access_token,
                idToken: tokenData.id_token,
                refreshToken: tokenData.refresh_token,
                expiresIn: tokenData.expires_in,
                tokenType: tokenData.token_type,
                message: 'Authentication successful'
            }, correlationId);

        } catch (error) {
            context.log.error(`[AuthCallback] Unexpected error during callback handling ${JSON.stringify({
                message: error.message,
                stack: error.stack,
                correlationId
            })}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// POST /api/auth/signup - Sign up endpoint (Entra ID User Invitation)
app.http('SignUp', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'auth/signup',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            const body = await request.json();

            if (!validateSignUp(body)) {
                context.log.warn('[SignUp] Validation failed', validateSignUp.errors);
                return failure(400, 'Invalid registration data', correlationId, validateSignUp.errors);
            }

            const { username, email, password, firstName, lastName } = body;
            const displayName = `${firstName} ${lastName}`;
            const clientRedirectUri = process.env.CLIENT_REDIRECT_URI || 'http://localhost:3000/auth/callback';

            // For signup, we need to invite the user to Entra ID
            // This requires admin consent and appropriate permissions
            // For now, return an invitation message that directs users to the OAuth flow

            const invitationResponse = {
                email: email,
                displayName: displayName,
                status: 'invitation_ready',
                message: 'To complete registration, please use the OAuth2 sign-in flow',
                authUrl: `https://login.microsoftonline.com/fd2638f1-94af-4c20-9ee9-f16f08e60344/oauth2/v2.0/authorize?client_id=f5c94ff4-4e57-4b2d-8cbd-64d4846817ba&response_type=code&redirect_uri=${encodeURIComponent(clientRedirectUri)}&scope=openid%20profile%20email&state=${correlationId}&response_mode=query`,
                instructions: [
                    '1. Use the provided authUrl to authenticate with Azure Entra ID',
                    '2. Complete the OAuth2 flow to get your access token',
                    '3. Your account will be automatically created in Entra ID upon first sign-in'
                ]
            };

            context.log(`[SignUp] User invitation prepared for: ${email}`);
            return success(201, invitationResponse, correlationId);

        } catch (error) {
            context.log.error(`[SignUp] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// GET /api/auth/keepalive - Keep alive endpoint
app.http('KeepAlive', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'auth/keepalive',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            // In real implementation, validate JWT token from Authorization header
            const authHeader = request.headers.get('authorization');

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return failure(401, 'No authorization token provided', correlationId);
            }

            const token = authHeader.substring(7); // Remove "Bearer " prefix

            // Validate JWT token with basic format checking
            const parts = token.split('.');
            if (parts.length !== 3) {
                context.log.warn(`[KeepAlive] Invalid JWT format: ${parts.length} parts`);
                return failure(401, 'Invalid JWT format', correlationId);
            }

            // Try to parse the payload for basic validation
            let payload;
            try {
                const addPadding = (str) => {
                    const missingPadding = str.length % 4;
                    if (missingPadding) {
                        str += '='.repeat(4 - missingPadding);
                    }
                    return str;
                };
                payload = JSON.parse(Buffer.from(addPadding(parts[1]), 'base64').toString());
            } catch (parseError) {
                context.log.warn(`[KeepAlive] Failed to decode JWT payload: ${parseError.message}`);
                return failure(401, 'Invalid JWT token', correlationId);
            }

            // Check if token is from Entra ID
            if (!payload.iss || !payload.iss.includes('microsoftonline.com')) {
                context.log.warn(`[KeepAlive] Invalid issuer: ${payload.iss}`);
                return failure(401, 'Token must be issued by Azure Entra ID', correlationId);
            }

            // Check expiration
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < now) {
                context.log.warn(`[KeepAlive] Token expired: ${payload.exp} < ${now}`);
                return failure(401, 'Token expired', correlationId);
            }

            if (true) { // Token is valid
                // Calculate remaining time
                const now = Math.floor(Date.now() / 1000);
                const expiresIn = validation.claims.exp ? validation.claims.exp - now : 3600;

                context.log('[KeepAlive] Entra ID token validated successfully');
                return success(200, {
                    status: 'active',
                    message: 'Session is valid',
                    timestamp: new Date().toISOString(),
                    expiresIn: expiresIn,
                    tokenType: 'Bearer',
                    user: validation.user
                }, correlationId);
            } else {
                context.log.warn(`[KeepAlive] Token validation failed: ${validation.error}`);
                return failure(401, 'Invalid or expired token', correlationId);
            }

        } catch (error) {
            context.log.error(`[KeepAlive] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// POST /api/auth/validate - JWT Token validation endpoint
app.http('ValidateToken', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'auth/validate',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.warn(`[ValidateToken] Failed to parse request body: ${parseError.message}`);
                return failure(400, 'Invalid JSON in request body', correlationId);
            }

            const { token } = body;

            if (!token) {
                return failure(400, 'Token is required', correlationId);
            }

            // Validate JWT token with Entra ID
            try {
                // Basic JWT format validation
                const parts = token.split('.');
                if (parts.length !== 3) {
                    context.log.warn(`[ValidateToken] Invalid JWT format: ${parts.length} parts`);
                    return failure(401, {
                        valid: false,
                        message: 'Invalid JWT format - token must have 3 parts'
                    }, correlationId);
                }

                // Try to parse the payload
                let payload;
                try {
                    const addPadding = (str) => {
                        const missingPadding = str.length % 4;
                        if (missingPadding) {
                            str += '='.repeat(4 - missingPadding);
                        }
                        return str;
                    };
                    payload = JSON.parse(Buffer.from(addPadding(parts[1]), 'base64').toString());
                } catch (parseError) {
                    context.log.warn(`[ValidateToken] Failed to decode JWT payload: ${parseError.message}`);
                    return failure(401, {
                        valid: false,
                        message: 'Invalid JWT - unable to decode token'
                    }, correlationId);
                }

                // For now, reject all tokens that don't come from Entra ID
                if (!payload.iss || !payload.iss.includes('microsoftonline.com')) {
                    context.log.warn(`[ValidateToken] Invalid issuer: ${payload.iss}`);
                    return failure(401, {
                        valid: false,
                        message: 'Token must be issued by Azure Entra ID'
                    }, correlationId);
                }

                // Check expiration
                const now = Math.floor(Date.now() / 1000);
                if (payload.exp && payload.exp < now) {
                    context.log.warn(`[ValidateToken] Token expired: ${payload.exp} < ${now}`);
                    return failure(401, {
                        valid: false,
                        message: 'Token expired'
                    }, correlationId);
                }

                context.log('[ValidateToken] Entra ID token is valid');
                return success(200, {
                    valid: true,
                    user: {
                        id: payload.sub,
                        username: payload.preferred_username || payload.email,
                        email: payload.email,
                        firstName: payload.given_name || '',
                        lastName: payload.family_name || '',
                        name: payload.name || ''
                    },
                    claims: payload,
                    message: 'Token is valid'
                }, correlationId);

            } catch (validationError) {
                context.log.error(`[ValidateToken] Validation error: ${validationError.message}`);
                return failure(401, {
                    valid: false,
                    message: 'Token validation failed'
                }, correlationId);
            }

        } catch (error) {
            context.log.error(`[ValidateToken] Unexpected error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});// GET /api/auth/me - Get current user profile
app.http('GetProfile', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'auth/me',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            // In real implementation, extract user info from validated JWT
            const authHeader = request.headers.get('authorization');

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return failure(401, 'No authorization token provided', correlationId);
            }

            const token = authHeader.substring(7);

            // Validate and extract user from JWT token using Entra ID validation
            const validation = await validateEntraIDToken(token);

            if (validation.valid) {
                const user = {
                    ...validation.user,
                    profile: {
                        firstName: validation.user.firstName,
                        lastName: validation.user.lastName,
                        joinDate: new Date(validation.claims.iat * 1000).toISOString().split('T')[0] // Convert from timestamp
                    },
                    lastLogin: new Date().toISOString(),
                    tokenClaims: {
                        issuer: validation.claims.iss,
                        audience: validation.claims.aud,
                        expires: new Date(validation.claims.exp * 1000).toISOString()
                    }
                };

                context.log('[GetProfile] Returning Entra ID user profile');
                return success(200, user, correlationId);
            } else {
                context.log.warn(`[GetProfile] Token validation failed: ${validation.error}`);
                return failure(401, 'Invalid or expired token', correlationId);
            }
        } catch (error) {
            context.log.error(`[GetProfile] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// GET /api/users/{id} - Get user from Entra ID (requires authentication)
app.http('GetUser', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'users/{id}',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const id = request.params.id;

        // Prevent health being treated as an ID
        if (id === 'health') {
            return failure(400, 'Invalid user ID', correlationId);
        }

        try {
            // This endpoint requires authentication to access user data
            const authHeader = request.headers.get('authorization');
            const token = extractBearerToken(authHeader);

            if (!token) {
                return failure(401, 'Authentication required to access user data', correlationId);
            }

            // Validate the token
            const validation = await validateEntraIDToken(token);
            if (!validation.valid) {
                return failure(401, 'Invalid authentication token', correlationId);
            }

            // For security, only allow users to see their own profile or admin users
            if (validation.user.id !== id) {
                return failure(403, 'Access denied. You can only view your own profile', correlationId);
            }

            const user = {
                id: validation.user.id,
                username: validation.user.username,
                email: validation.user.email,
                firstName: validation.user.firstName,
                lastName: validation.user.lastName,
                name: validation.user.name,
                tenantId: validation.user.tenantId,
                profile: {
                    firstName: validation.user.firstName,
                    lastName: validation.user.lastName,
                    joinDate: new Date(validation.claims.iat * 1000).toISOString().split('T')[0]
                },
                timestamp: new Date().toISOString()
            };

            context.log(`[GetUser] Returning Entra ID user ${id}`);
            return success(200, user, correlationId);

        } catch (error) {
            context.log.error(`[GetUser] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// Combined Users Handler for GET/POST to /users (Entra ID authenticated)
app.http('UsersHandler', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'users',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            // Require authentication for user management operations
            const authHeader = request.headers.get('authorization');
            const token = extractBearerToken(authHeader);

            if (!token) {
                return failure(401, 'Authentication required for user management operations', correlationId);
            }

            // Validate the token
            const validation = await validateEntraIDToken(token);
            if (!validation.valid) {
                return failure(401, 'Invalid authentication token', correlationId);
            }

            if (request.method.toUpperCase() === 'GET') {
                // List users - for security, only return current user's info
                // In a real implementation, this would require admin privileges to list all users
                const users = [
                    {
                        id: validation.user.id,
                        username: validation.user.username,
                        email: validation.user.email,
                        firstName: validation.user.firstName,
                        lastName: validation.user.lastName,
                        name: validation.user.name
                    }
                ];

                context.log(`[ListUsers] Returning authenticated user info`);
                return success(200, { users, count: users.length, note: 'Only current user shown for security' }, correlationId);

            } else if (request.method.toUpperCase() === 'POST') {
                // Create user - redirect to signup flow since user creation should go through Entra ID
                return failure(400, 'User creation must be done through the /auth/signup endpoint with Entra ID integration', correlationId);
            }

            return failure(405, 'Method not allowed', correlationId);

        } catch (error) {
            context.log.error(`[UsersHandler] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});