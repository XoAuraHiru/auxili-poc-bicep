import { app } from '@azure/functions';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';  // For email format validation
import { withCorrelation, success, failure } from '../utils/shared.js';

// Setup validation with email format support
const ajv = new Ajv();
addFormats(ajv);  // Adds email format validation

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

// GET /api/users/{id}
app.http('GetUser', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'users/{id}',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const id = request.params.id;
        
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

// POST /api/users  
app.http('CreateUser', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'users',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        
        try {
            const body = await request.json();
            
            // Validate request body
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
            
        } catch (error) {
            context.log.error(`[CreateUser] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// GET /api/users (List users - bonus endpoint)
app.http('ListUsers', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'users',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        
        try {
            // Mock user list (replace with database query)
            const users = [
                { id: '1', username: 'alice', email: 'alice@example.com' },
                { id: '2', username: 'bob', email: 'bob@example.com' },
                { id: '3', username: 'charlie', email: 'charlie@example.com' }
            ];
            
            context.log(`[ListUsers] Returning ${users.length} users`);
            return success(200, { users, count: users.length }, correlationId);
            
        } catch (error) {
            context.log.error(`[ListUsers] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// Health check
app.http('UserHealth', {
    methods: ['GET'],
    authLevel: 'anonymous', 
    route: 'users/health',
    handler: async (request, context) => {
        return {
            status: 200,
            jsonBody: { 
                service: 'users', 
                status: 'healthy', 
                timestamp: new Date().toISOString() 
            }
        };
    }
});