module.exports = async function (context, req) {
    context.log('Orders health check function processed a request.');

    const healthStatus = {
        service: 'orders',
        status: 'healthy',
        version: 'v3',
        timestamp: new Date().toISOString(),
        message: 'Orders service is running properly'
    };

    context.res = {
        status: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: healthStatus
    };
};