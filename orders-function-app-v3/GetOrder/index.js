const { authorizeRequest, buildAuthFailureResponse } = require('../shared/authorization');

module.exports = async function (context, req) {
    const correlationId = req.headers?.['x-correlation-id'] || context.invocationId;
    const requiredRoles = process.env.ORDERS_READ_ROLES || process.env.AUTH_REQUIRED_ROLES || 'Orders.Read Orders.Admin';
    const requiredScopes = process.env.ORDERS_READ_SCOPES || process.env.AUTH_REQUIRED_SCOPES || '';

    try {
        const authResult = await authorizeRequest(req, context, {
            requiredRoles,
            requiredScopes,
            allowedTenants: process.env.ORDERS_ALLOWED_TENANTS || process.env.AUTH_ALLOWED_TENANTS,
            allowedClients: process.env.ORDERS_ALLOWED_CLIENTS || process.env.AUTH_ALLOWED_CLIENTS
        });

        const orderId = context.bindingData.id;
        context.log(`[GetOrder] Authorized request`, {
            orderId,
            subject: authResult.claims?.sub || null,
            correlationId
        });

        const order = {
            id: orderId,
            customerName: `Customer ${orderId}`,
            amount: 99.99,
            status: 'pending',
            items: [
                {
                    name: `Product ${orderId}`,
                    quantity: 2,
                    price: 49.99
                }
            ],
            timestamp: new Date().toISOString()
        };

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: {
                data: order,
                correlationId,
                issuedTo: authResult.claims?.preferred_username || authResult.claims?.email || null
            }
        };
    } catch (error) {
        context.log.warn('[GetOrder] Authorization failure', {
            message: error?.message,
            code: error?.details?.code,
            correlationId
        });

        context.res = buildAuthFailureResponse(error, correlationId);
    }
};