#!/bin/bash

# Auxili Microservices - Complete Deployment with Authentication
# This script deploys the entire microservices infrastructure with Entra ID authentication

set -e

# Configuration
RESOURCE_GROUP_PREFIX="rg-auxili"
ENVIRONMENT=${1:-"dev"}
LOCATION=${2:-"Southeast Asia"}
ORG_NAME="auxili"
PROJECT_NAME="microservices"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    print_error "Invalid environment. Must be dev, staging, or prod"
    exit 1
fi

RESOURCE_GROUP="${RESOURCE_GROUP_PREFIX}-${ENVIRONMENT}"

print_status "Starting deployment for environment: $ENVIRONMENT"
print_status "Resource Group: $RESOURCE_GROUP"
print_status "Location: $LOCATION"

# Check if Azure CLI is installed and logged in
if ! command -v az &> /dev/null; then
    print_error "Azure CLI is not installed. Please install it first."
    exit 1
fi

if ! az account show &> /dev/null; then
    print_error "Not logged in to Azure. Please run 'az login' first."
    exit 1
fi

# Get current subscription
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
print_status "Using subscription: $SUBSCRIPTION_ID"

# Create resource group if it doesn't exist
print_status "Creating resource group..."
az group create \
    --name "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --output none

print_success "Resource group created/updated"

# Step 1: Check if Entra ID app registration is needed
print_status "Checking Entra ID app registration..."

PARAM_FILE="parameters/${ENVIRONMENT}.parameters.json"
if [[ ! -f "$PARAM_FILE" ]]; then
    print_error "Parameter file not found: $PARAM_FILE"
    exit 1
fi

# Check if entraAppId is set in parameters
ENTRA_APP_ID=$(jq -r '.parameters.entraAppId.value' "$PARAM_FILE")

if [[ "$ENTRA_APP_ID" == "" || "$ENTRA_APP_ID" == "replace-with-"*"-app-id" ]]; then
    if [[ "$ENVIRONMENT" != "dev" ]]; then
        print_warning "Entra ID App Registration required for $ENVIRONMENT environment"
        print_status "Creating Entra ID app registration..."
        
        # Create app registration using PowerShell script (if available)
        if command -v pwsh &> /dev/null; then
            APP_NAME="${ORG_NAME}-${PROJECT_NAME}-api"
            print_status "Running PowerShell script to create app registration..."
            
            pwsh -File "scripts/create-entra-app.ps1" \
                -AppName "$APP_NAME" \
                -Environment "$ENVIRONMENT" \
                -ReplyUrls "http://localhost:3000,https://oauth.pstmn.io/v1/callback"
            
            print_warning "Please update the entraAppId parameter in $PARAM_FILE with the Application ID from the script output"
            print_warning "Then re-run this deployment script"
            exit 0
        else
            print_error "PowerShell not available. Please create the Entra ID app registration manually:"
            print_error "1. Go to Azure Portal > Entra ID > App registrations"
            print_error "2. Create new registration: ${ORG_NAME}-${PROJECT_NAME}-api-${ENVIRONMENT}"
            print_error "3. Configure redirect URIs: http://localhost:3000, https://oauth.pstmn.io/v1/callback"
            print_error "4. Update the entraAppId parameter in $PARAM_FILE"
            exit 1
        fi
    else
        print_status "Development environment - authentication disabled"
    fi
else
    print_success "Entra ID App Registration configured: $ENTRA_APP_ID"
fi

# Step 2: Deploy infrastructure
print_status "Deploying infrastructure..."

DEPLOYMENT_NAME="auxili-deployment-$(date +%Y%m%d-%H%M%S)"

az deployment group create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$DEPLOYMENT_NAME" \
    --template-file "main.bicep" \
    --parameters "@$PARAM_FILE" \
    --output table

if [[ $? -eq 0 ]]; then
    print_success "Infrastructure deployment completed"
else
    print_error "Infrastructure deployment failed"
    exit 1
fi

# Step 3: Get deployment outputs
print_status "Retrieving deployment outputs..."

OUTPUTS=$(az deployment group show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$DEPLOYMENT_NAME" \
    --query "properties.outputs" \
    --output json)

# Extract key outputs
APIM_GATEWAY_URL=$(echo "$OUTPUTS" | jq -r '.apimGatewayUrl.value // ""')
PRODUCT_FUNCTION_NAME=$(echo "$OUTPUTS" | jq -r '.productFunctionAppName.value // ""')
USER_FUNCTION_NAME=$(echo "$OUTPUTS" | jq -r '.userFunctionAppName.value // ""')
ORDERS_FUNCTION_NAME=$(echo "$OUTPUTS" | jq -r '.ordersFunctionAppName.value // ""')
TENANT_ID=$(echo "$OUTPUTS" | jq -r '.tenantId.value // ""')
AUTH_ENABLED=$(echo "$OUTPUTS" | jq -r '.authenticationEnabled.value // false')

print_success "Deployment Summary:"
echo "=================================="
echo "Environment: $ENVIRONMENT"
echo "Resource Group: $RESOURCE_GROUP"
echo "API Gateway URL: $APIM_GATEWAY_URL"
echo "Authentication Enabled: $AUTH_ENABLED"
echo "Tenant ID: $TENANT_ID"
echo "Function Apps:"
echo "  - Product: $PRODUCT_FUNCTION_NAME"
echo "  - User: $USER_FUNCTION_NAME"
echo "  - Orders: $ORDERS_FUNCTION_NAME"

# Step 4: Deploy Function Apps (if code is ready)
if [[ -d "../product-function-app-v4" ]]; then
    print_status "Deploying Function Apps..."
    
    # Deploy product function app
    if [[ -n "$PRODUCT_FUNCTION_NAME" ]]; then
        print_status "Deploying Product Function App..."
        cd "../product-function-app-v4"
        func azure functionapp publish "$PRODUCT_FUNCTION_NAME" --build-native-deps
        cd "../infrastructure"
        print_success "Product Function App deployed"
    fi
    
    # Deploy user function app
    if [[ -n "$USER_FUNCTION_NAME" ]]; then
        print_status "Deploying User Function App..."
        cd "../user-function-app-v4"
        func azure functionapp publish "$USER_FUNCTION_NAME" --build-native-deps
        cd "../infrastructure"
        print_success "User Function App deployed"
    fi
    
    # Deploy orders function app
    if [[ -n "$ORDERS_FUNCTION_NAME" ]]; then
        print_status "Deploying Orders Function App..."
        cd "../orders-function-app-v3"
        func azure functionapp publish "$ORDERS_FUNCTION_NAME" --build-native-deps
        cd "../infrastructure"
        print_success "Orders Function App deployed"
    fi
else
    print_warning "Function app source code not found. Deploy manually using:"
    print_warning "func azure functionapp publish <function-app-name>"
fi

# Step 5: Test deployment
print_status "Testing deployment..."

if [[ -n "$APIM_GATEWAY_URL" ]]; then
    # Test health endpoints (should work without authentication)
    print_status "Testing health endpoints..."
    
    for endpoint in "products/health" "users/health" "orders/health"; do
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$APIM_GATEWAY_URL/$endpoint" || echo "000")
        if [[ "$HTTP_STATUS" == "200" ]]; then
            print_success "✓ $endpoint - OK"
        else
            print_warning "✗ $endpoint - Status: $HTTP_STATUS"
        fi
    done
    
    # Test protected endpoint (should return 401 if auth is enabled)
    if [[ "$AUTH_ENABLED" == "true" ]]; then
        print_status "Testing protected endpoint (should return 401)..."
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$APIM_GATEWAY_URL/products/1" || echo "000")
        if [[ "$HTTP_STATUS" == "401" ]]; then
            print_success "✓ Authentication working - protected endpoint returns 401"
        else
            print_warning "✗ Protected endpoint returned: $HTTP_STATUS (expected 401)"
        fi
    fi
else
    print_warning "API Gateway URL not available for testing"
fi

# Step 6: Generate summary and next steps
print_success "Deployment completed successfully!"

echo ""
echo "=================================="
echo "NEXT STEPS:"
echo "=================================="

if [[ "$AUTH_ENABLED" == "true" ]]; then
    echo "1. Authentication Configuration:"
    echo "   - Client ID: $ENTRA_APP_ID"
    echo "   - Tenant ID: $TENANT_ID"
    echo "   - Authority: https://login.microsoftonline.com/$TENANT_ID"
    echo ""
    echo "2. Test Authentication:"
    echo "   - Open examples/auth-demo.html in a browser"
    echo "   - Update the configuration with your values"
    echo "   - Test sign-in and API calls"
    echo ""
    echo "3. API Usage:"
    echo "   - Base URL: $APIM_GATEWAY_URL"
    echo "   - Include 'Authorization: Bearer <token>' header for protected endpoints"
    echo ""
else
    echo "1. Development Environment (No Authentication):"
    echo "   - API Base URL: $APIM_GATEWAY_URL"
    echo "   - All endpoints are publicly accessible"
    echo ""
fi

echo "4. Documentation:"
echo "   - Read AUTHENTICATION.md for detailed setup instructions"
echo "   - Check Azure Portal for resource configuration"
echo ""

echo "5. Monitoring:"
echo "   - Check Application Insights for logs and metrics"
echo "   - Monitor API Management analytics"

print_success "Deployment process completed!"