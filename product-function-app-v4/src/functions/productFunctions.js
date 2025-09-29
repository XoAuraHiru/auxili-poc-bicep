import { app } from '@azure/functions';
import Ajv from 'ajv';
import { withCorrelation, success, failure } from '../utils/shared.js';
import { authorizeRequest, buildAuthFailureResponse } from '../utils/authorization.js';

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

const getReadAuthOptions = () => ({
    requiredRoles: process.env.PRODUCT_READ_ROLES || process.env.AUTH_REQUIRED_ROLES || 'Products.Read Products.Admin',
    requiredScopes: process.env.PRODUCT_READ_SCOPES || process.env.AUTH_REQUIRED_SCOPES || 'Products.Read',
    allowedTenants: process.env.PRODUCT_ALLOWED_TENANTS || process.env.AUTH_ALLOWED_TENANTS,
    allowedClients: process.env.PRODUCT_ALLOWED_CLIENTS || process.env.AUTH_ALLOWED_CLIENTS
});

const getWriteAuthOptions = () => ({
    requiredRoles: process.env.PRODUCT_WRITE_ROLES || process.env.AUTH_REQUIRED_ROLES || 'Products.Write Products.Admin',
    requiredScopes: process.env.PRODUCT_WRITE_SCOPES || process.env.AUTH_REQUIRED_SCOPES || 'Products.Write',
    allowedTenants: process.env.PRODUCT_ALLOWED_TENANTS || process.env.AUTH_ALLOWED_TENANTS,
    allowedClients: process.env.PRODUCT_ALLOWED_CLIENTS || process.env.AUTH_ALLOWED_CLIENTS
});

// GET /api/products/{id}
app.http('GetProduct', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'products/{id}',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);
        const id = request.params.id;

        try {
            const authResult = await authorizeRequest(request, context, getReadAuthOptions());
            const product = {
                id,
                name: `Sample Product ${id}`,
                price: 19.99,
                category: 'Electronics',
                timestamp: new Date().toISOString()
            };

            context.log(`[GetProduct] Returning product ${id}`, {
                subject: authResult.claims?.sub || null,
                correlationId
            });

            return success(200, {
                ...product,
                requestedBy: authResult.claims?.preferred_username || authResult.claims?.email || authResult.claims?.name || null
            }, correlationId);
        } catch (error) {
            if (error?.name === 'AuthorizationError') {
                context.log.warn('[GetProduct] Authorization failure', {
                    message: error.message,
                    code: error.details?.code,
                    correlationId
                });
                return buildAuthFailureResponse(error, correlationId);
            }

            context.log.error(`[GetProduct] Error: ${error.message}`);
            return failure(500, 'Internal server error', correlationId);
        }
    }
});

// POST /api/products
app.http('CreateProduct', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'products',
    handler: async (request, context) => {
        const correlationId = withCorrelation(context, request);

        try {
            const authResult = await authorizeRequest(request, context, getWriteAuthOptions());
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
                createdAt: new Date().toISOString(),
                createdBy: authResult.claims?.preferred_username || authResult.claims?.email || authResult.claims?.name || null
            };

            context.log(`[CreateProduct] Created product ${id}`, {
                subject: authResult.claims?.sub || null,
                correlationId
            });
            return success(201, created, correlationId);

        } catch (error) {
            if (error?.name === 'AuthorizationError') {
                context.log.warn('[CreateProduct] Authorization failure', {
                    message: error.message,
                    code: error.details?.code,
                    correlationId
                });
                return buildAuthFailureResponse(error, correlationId);
            }

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