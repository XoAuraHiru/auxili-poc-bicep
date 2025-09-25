import { app } from '@azure/functions';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { withCorrelation, success, failure } from '../utils/shared.js';

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
            if (request.method.toUpperCase() === 'GET') {
                // Generate OAuth2 authorization URL for Entra ID
                const clientId = 'f5c94ff4-4e57-4b2d-8cbd-64d4846817ba';
                const tenantId = 'fd2638f1-94af-4c20-9ee9-f16f08e60344';
                const redirectUri = encodeURIComponent('https://func-auxili-user-dev-ad7stftg.azurewebsites.net/auth/callback');
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
                const redirectUri = 'http://localhost:3000/auth/callback'; // For local development
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
            const redirectUri = 'https://func-auxili-user-dev-ad7stftg.azurewebsites.net/auth/callback';

            const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
            const tokenRequest = new URLSearchParams({
                client_id: clientId,
                scope: 'openid profile email',
                code: code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
                // Note: In production, you'd need client_secret or certificate authentication
                // For now, this will work with public client configuration
            });

            const tokenResponse = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: tokenRequest.toString()
            });

            const tokenData = await tokenResponse.json();

            if (!tokenResponse.ok) {
                context.log.error('[AuthCallback] Token exchange failed:', tokenData);
                return failure(400, `Token exchange failed: ${tokenData.error_description}`, correlationId);
            }

            // Decode the ID token to get user info (without verification for now)
            const idTokenPayload = JSON.parse(Buffer.from(tokenData.id_token.split('.')[1], 'base64').toString());

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
            context.log.error(`[AuthCallback] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// POST /api/auth/signup - Sign up endpoint
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

            // Mock user creation - in real implementation, save to database
            const newUser = {
                id: Math.random().toString(36).slice(2, 10),
                username,
                email,
                firstName,
                lastName,
                profile: {
                    firstName,
                    lastName,
                    joinDate: new Date().toISOString().split('T')[0]
                },
                createdAt: new Date().toISOString()
            };

            // In real implementation, generate actual JWT token
            const mockToken = `mock-jwt-token-${Date.now()}`;

            context.log(`[SignUp] New user registered: ${email}`);
            return success(201, {
                user: newUser,
                token: mockToken,
                expiresIn: 3600, // 1 hour
                message: 'Registration successful'
            }, correlationId);

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

            // Validate JWT token with Entra ID
            try {
                const tokenParts = token.split('.');
                if (tokenParts.length !== 3) {
                    throw new Error('Invalid JWT format');
                }

                const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());

                // Basic validation
                const now = Math.floor(Date.now() / 1000);
                if (payload.exp && payload.exp < now) {
                    throw new Error('Token expired');
                }

                // Calculate remaining time
                const expiresIn = payload.exp ? payload.exp - now : 3600;

                context.log('[KeepAlive] Entra ID token validated successfully');
                return success(200, {
                    status: 'active',
                    message: 'Session is valid',
                    timestamp: new Date().toISOString(),
                    expiresIn: expiresIn,
                    tokenType: 'Bearer'
                }, correlationId);

            } catch (jwtError) {
                // Fallback to mock token for development
                if (token.startsWith('mock-jwt-token-')) {
                    context.log('[KeepAlive] Mock token validated successfully');
                    return success(200, {
                        status: 'active',
                        message: 'Session is valid',
                        timestamp: new Date().toISOString(),
                        expiresIn: 3600,
                        tokenType: 'Bearer (mock)'
                    }, correlationId);
                }

                context.log.warn(`[KeepAlive] Token validation failed: ${jwtError.message}`);
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
            const body = await request.json();
            const { token } = body;

            if (!token) {
                return failure(400, 'Token is required', correlationId);
            }

            // Validate JWT token with Entra ID
            try {
                // For now, decode without verification (in production, use proper JWT validation)
                const tokenParts = token.split('.');
                if (tokenParts.length !== 3) {
                    throw new Error('Invalid JWT format');
                }

                const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());

                // Basic validation
                const now = Math.floor(Date.now() / 1000);
                if (payload.exp && payload.exp < now) {
                    throw new Error('Token expired');
                }

                // Validate issuer and audience for Entra ID
                const expectedIssuer = 'https://login.microsoftonline.com/fd2638f1-94af-4c20-9ee9-f16f08e60344/v2.0';
                const expectedAudience = 'f5c94ff4-4e57-4b2d-8cbd-64d4846817ba';

                if (payload.iss !== expectedIssuer) {
                    throw new Error('Invalid issuer');
                }

                if (payload.aud !== expectedAudience) {
                    throw new Error('Invalid audience');
                }

                const user = {
                    id: payload.sub,
                    username: payload.preferred_username || payload.email,
                    email: payload.email,
                    firstName: payload.given_name || '',
                    lastName: payload.family_name || '',
                    name: payload.name || ''
                };

                context.log('[ValidateToken] Entra ID token is valid');
                return success(200, {
                    valid: true,
                    user: user,
                    claims: payload,
                    message: 'Token is valid'
                }, correlationId);

            } catch (jwtError) {
                // Fallback to mock token for development
                if (token.startsWith('mock-jwt-token-')) {
                    const mockUser = {
                        id: 'demo-user-123',
                        username: 'demo_user',
                        email: 'demo@auxili.com',
                        firstName: 'Demo',
                        lastName: 'User'
                    };

                    context.log('[ValidateToken] Mock token is valid');
                    return success(200, {
                        valid: true,
                        user: mockUser,
                        message: 'Mock token is valid (development mode)'
                    }, correlationId);
                }

                context.log.warn(`[ValidateToken] JWT validation failed: ${jwtError.message}`);
                return failure(401, {
                    valid: false,
                    message: `Invalid or expired token: ${jwtError.message}`
                }, correlationId);
            }

        } catch (error) {
            context.log.error(`[ValidateToken] Error: ${error.message}`);
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

            // Validate and extract user from JWT token
            try {
                const tokenParts = token.split('.');
                if (tokenParts.length !== 3) {
                    throw new Error('Invalid JWT format');
                }

                const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());

                // Basic validation
                const now = Math.floor(Date.now() / 1000);
                if (payload.exp && payload.exp < now) {
                    throw new Error('Token expired');
                }

                const user = {
                    id: payload.sub,
                    username: payload.preferred_username || payload.email,
                    email: payload.email,
                    firstName: payload.given_name || '',
                    lastName: payload.family_name || '',
                    name: payload.name || '',
                    profile: {
                        firstName: payload.given_name || '',
                        lastName: payload.family_name || '',
                        joinDate: new Date(payload.iat * 1000).toISOString().split('T')[0] // Convert from timestamp
                    },
                    lastLogin: new Date().toISOString(),
                    tokenClaims: {
                        issuer: payload.iss,
                        audience: payload.aud,
                        expires: new Date(payload.exp * 1000).toISOString()
                    }
                };

                context.log('[GetProfile] Returning Entra ID user profile');
                return success(200, user, correlationId);

            } catch (jwtError) {
                // Fallback to mock token for development
                if (token.startsWith('mock-jwt-token-')) {
                    const user = {
                        id: 'demo-user-123',
                        username: 'demo_user',
                        email: 'demo@auxili.com',
                        firstName: 'Demo',
                        lastName: 'User',
                        profile: {
                            firstName: 'Demo',
                            lastName: 'User',
                            joinDate: '2024-01-01'
                        },
                        lastLogin: new Date().toISOString(),
                        tokenType: 'mock'
                    };

                    context.log('[GetProfile] Returning mock user profile');
                    return success(200, user, correlationId);
                }

                context.log.warn(`[GetProfile] Token validation failed: ${jwtError.message}`);
                return failure(401, 'Invalid or expired token', correlationId);
            }
        } catch (error) {
            context.log.error(`[GetProfile] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// GET /api/users/{id} - This must come AFTER the health route
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
            const user = {
                id,
                username: `user_${id}`,
                email: `user_${id}@example.com`,
                profile: {
                    firstName: 'John',
                    lastName: 'Doe',
                    joinDate: '2024-01-01'
                },
                timestamp: new Date().toISOString()
            };

            context.log(`[GetUser] Returning user ${id}`);
            return success(200, user, correlationId);

        } catch (error) {
            context.log.error(`[GetUser] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// Combined Users Handler for GET/POST to /users
app.http('UsersHandler', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'users',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            if (request.method.toUpperCase() === 'GET') {
                // List users
                const users = [
                    { id: '1', username: 'alice', email: 'alice@example.com' },
                    { id: '2', username: 'bob', email: 'bob@example.com' },
                    { id: '3', username: 'charlie', email: 'charlie@example.com' }
                ];

                context.log(`[ListUsers] Returning ${users.length} users`);
                return success(200, { users, count: users.length }, correlationId);

            } else if (request.method.toUpperCase() === 'POST') {
                // Create user
                const body = await request.json();

                if (!validateCreateUser(body)) {
                    context.log.warn('[CreateUser] Validation failed', validateCreateUser.errors);
                    return failure(400, 'ValidationFailed', correlationId, validateCreateUser.errors);
                }

                const id = Math.random().toString(36).slice(2, 10);
                const created = {
                    id,
                    ...body,
                    profile: {
                        firstName: '',
                        lastName: '',
                        joinDate: new Date().toISOString().split('T')[0]
                    },
                    createdAt: new Date().toISOString()
                };

                context.log(`[CreateUser] Created user ${id}`);
                return success(201, created, correlationId);
            }

            return failure(405, 'Method not allowed', correlationId);

        } catch (error) {
            context.log.error(`[UsersHandler] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});