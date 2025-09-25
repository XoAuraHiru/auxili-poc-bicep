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