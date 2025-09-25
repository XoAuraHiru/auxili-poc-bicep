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

// POST /api/auth/signin - Sign in endpoint
app.http('SignIn', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'auth/signin',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            const body = await request.json();

            if (!validateSignIn(body)) {
                context.log.warn('[SignIn] Validation failed', validateSignIn.errors);
                return failure(400, 'Invalid email or password format', correlationId, validateSignIn.errors);
            }

            const { email, password } = body;

            // Mock authentication - in real implementation, verify against database
            if (email === 'demo@auxili.com' && password === 'password123') {
                const user = {
                    id: 'demo-user-123',
                    username: 'demo_user',
                    email: email,
                    firstName: 'Demo',
                    lastName: 'User'
                };

                // In real implementation, generate actual JWT token
                const mockToken = `mock-jwt-token-${Date.now()}`;

                context.log(`[SignIn] Successful login for ${email}`);
                return success(200, {
                    user,
                    token: mockToken,
                    expiresIn: 3600, // 1 hour
                    message: 'Sign in successful'
                }, correlationId);
            } else {
                context.log.warn(`[SignIn] Failed login attempt for ${email}`);
                return failure(401, 'Invalid email or password', correlationId);
            }

        } catch (error) {
            context.log.error(`[SignIn] Error: ${error.message}`);
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

            // Mock token validation - in real implementation, verify JWT
            if (token.startsWith('mock-jwt-token-')) {
                context.log('[KeepAlive] Token validated successfully');
                return success(200, {
                    status: 'active',
                    message: 'Session is valid',
                    timestamp: new Date().toISOString(),
                    expiresIn: 3600 // Refresh token expiry
                }, correlationId);
            } else {
                context.log.warn('[KeepAlive] Invalid token provided');
                return failure(401, 'Invalid or expired token', correlationId);
            }

        } catch (error) {
            context.log.error(`[KeepAlive] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// POST /api/auth/validate - Token validation endpoint
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

            // Mock token validation - in real implementation, verify JWT
            if (token.startsWith('mock-jwt-token-')) {
                const mockUser = {
                    id: 'demo-user-123',
                    username: 'demo_user',
                    email: 'demo@auxili.com',
                    firstName: 'Demo',
                    lastName: 'User'
                };

                context.log('[ValidateToken] Token is valid');
                return success(200, {
                    valid: true,
                    user: mockUser,
                    message: 'Token is valid'
                }, correlationId);
            } else {
                context.log.warn('[ValidateToken] Invalid token provided');
                return failure(401, {
                    valid: false,
                    message: 'Invalid or expired token'
                }, correlationId);
            }

        } catch (error) {
            context.log.error(`[ValidateToken] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// GET /api/auth/me - Get current user profile
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

            // Mock token validation and user extraction
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
                    lastLogin: new Date().toISOString()
                };

                context.log('[GetProfile] Returning user profile');
                return success(200, user, correlationId);
            } else {
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