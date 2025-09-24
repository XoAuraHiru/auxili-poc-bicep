module.exports = async function (context, req) {
    const orderId = context.bindingData.id;

    context.log(`GetOrder function processed request for order: ${orderId}`);

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
        body: order
    };
};