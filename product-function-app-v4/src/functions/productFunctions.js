import { app } from '@azure/functions';
import Ajv from 'ajv';
import { withCorrelation, success, failure } from '../utils/shared.js';

// Validation schema for creating products
const ajv = new Ajv();
const createProductSchema = {
    type: 'object',
    properties: {
        name: { type: 'string', minLength: 1 },
        price: { type: 'number', minimum: 0 }
    },
    required: ['name', 'price'],
    additionalProperties: false
};
const validateCreateProduct = ajv.compile(createProductSchema);

// GET /api/products/{id}
app.http('GetProduct', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'products/{id}',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const id = request.params.id;
        
        try {
            const product = {
                id,
                name: `Sample Product ${id}`,
                price: 19.99,
                category: 'Electronics',
                timestamp: new Date().toISOString()
            };
            
            context.log(`[GetProduct] Returning product ${id}`);
            return success(200, product, correlationId);
            
        } catch (error) {
            context.log.error(`[GetProduct] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// POST /api/products
app.http('CreateProduct', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'products',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        
        try {
            const body = await request.json();
            
            // Validate request body
            if (!validateCreateProduct(body)) {
                context.log.warn('[CreateProduct] Validation failed', validateCreateProduct.errors);
                return failure(400, 'ValidationFailed', correlationId, validateCreateProduct.errors);
            }
            
            const id = Math.random().toString(36).slice(2, 10);
            const created = { 
                id, 
                ...body, 
                category: 'Electronics',
                createdAt: new Date().toISOString() 
            };
            
            context.log(`[CreateProduct] Created product ${id}`);
            return success(201, created, correlationId);
            
        } catch (error) {
            context.log.error(`[CreateProduct] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// Optional: Health check endpoint
app.http('ProductHealth', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'products/health',
    handler: async (request, context) => {
        return {
            status: 200,
            jsonBody: { 
                service: 'products', 
                status: 'healthy', 
                timestamp: new Date().toISOString() 
            }
        };
    }
});