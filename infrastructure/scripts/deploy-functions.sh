#!/bin/bash
set -e

RESOURCE_GROUP="rg-auxili-poc-v2-dev"

echo "Getting Function App names..."
PRODUCT_APP=$(az deployment group show -g $RESOURCE_GROUP -n main --query properties.outputs.productFunctionAppName.value -o tsv)
USER_APP=$(az deployment group show -g $RESOURCE_GROUP -n main --query properties.outputs.userFunctionAppName.value -o tsv)
ORDERS_APP=$(az deployment group show -g $RESOURCE_GROUP -n main --query properties.outputs.ordersFunctionAppName.value -o tsv)

echo "Deploying function code..."

# Deploy Product Function App
cd product-function-app-v4
echo "Installing dependencies for product app..."
npm install
echo "Deploying product app to $PRODUCT_APP..."
func azure functionapp publish $PRODUCT_APP --javascript
cd ..

# Deploy User Function App  
cd user-function-app-v4
echo "Installing dependencies for user app..."
npm install
echo "Deploying user app to $USER_APP..."
func azure functionapp publish $USER_APP --javascript
cd ..

# Deploy Orders Function App
cd orders-function-app-v3
echo "Installing dependencies for orders app..."
npm install
echo "Deploying orders app to $ORDERS_APP..."
func azure functionapp publish $ORDERS_APP --javascript
cd ..

echo "Function deployment complete!"