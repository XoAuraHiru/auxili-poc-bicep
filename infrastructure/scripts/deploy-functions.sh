#!/bin/bash
set -e

RESOURCE_GROUP="rg-auxili-poc-v2-dev"

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Get the project root directory (parent of infrastructure)
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

echo "Script directory: $SCRIPT_DIR"
echo "Project root: $PROJECT_ROOT"

echo "Getting Function App names..."
PRODUCT_APP=$(az deployment group show -g "$RESOURCE_GROUP" -n main --query properties.outputs.productFunctionAppName.value -o tsv)
USER_APP=$(az deployment group show -g "$RESOURCE_GROUP" -n main --query properties.outputs.userFunctionAppName.value -o tsv)
ORDERS_APP=$(az deployment group show -g "$RESOURCE_GROUP" -n main --query properties.outputs.ordersFunctionAppName.value -o tsv)

echo "Function App Names:"
echo "  Product: $PRODUCT_APP"
echo "  User: $USER_APP" 
echo "  Orders: $ORDERS_APP"

echo "Deploying function code..."

# Deploy Product Function App
cd "$PROJECT_ROOT/product-function-app-v4"
echo "Current directory: $(pwd)"
echo "Installing dependencies for product app..."
npm install
echo "Deploying product app to $PRODUCT_APP..."
func azure functionapp publish "$PRODUCT_APP" --javascript

# Deploy User Function App  
cd "$PROJECT_ROOT/user-function-app-v4"
echo "Current directory: $(pwd)"
echo "Installing dependencies for user app..."
npm install
echo "Deploying user app to $USER_APP..."
func azure functionapp publish "$USER_APP" --javascript

# # Deploy Orders Function App
# cd "$PROJECT_ROOT/orders-function-app-v3"
# echo "Current directory: $(pwd)"
# echo "Installing dependencies for orders app..."
# npm install
# echo "Deploying orders app to $ORDERS_APP..."
# func azure functionapp publish "$ORDERS_APP" --javascript

cd "$SCRIPT_DIR"
echo "Function deployment complete!"