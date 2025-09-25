#!/bin/bash

# Create Entra ID App Registration for API Authentication (Azure CLI version)
# This script creates an app registration that will be used for JWT authentication in APIM

set -e

# Default values
APP_NAME=""
ENVIRONMENT=""
REPLY_URLS="http://localhost:3000,https://oauth.pstmn.io/v1/callback"
HOMEPAGE_URL=""

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

# Function to show usage
usage() {
    echo "Usage: $0 -a <AppName> -e <Environment> [-r <ReplyUrls>] [-h <HomepageUrl>]"
    echo ""
    echo "Options:"
    echo "  -a, --app-name      Application name (required)"
    echo "  -e, --environment   Environment (dev/staging/prod) (required)"
    echo "  -r, --reply-urls    Comma-separated reply URLs (optional)"
    echo "  -h, --homepage-url  Homepage URL (optional)"
    echo "  --help              Show this help message"
    echo ""
    echo "Example:"
    echo "  $0 -a \"auxili-microservices-api\" -e \"dev\""
    exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -a|--app-name)
            APP_NAME="$2"
            shift 2
            ;;
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -r|--reply-urls)
            REPLY_URLS="$2"
            shift 2
            ;;
        -h|--homepage-url)
            HOMEPAGE_URL="$2"
            shift 2
            ;;
        --help)
            usage
            ;;
        *)
            print_error "Unknown option $1"
            usage
            ;;
    esac
done

# Validate required parameters
if [[ -z "$APP_NAME" ]]; then
    print_error "App name is required"
    usage
fi

if [[ -z "$ENVIRONMENT" ]]; then
    print_error "Environment is required"
    usage
fi

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    print_error "Environment must be dev, staging, or prod"
    exit 1
fi

APP_REGISTRATION_NAME="${APP_NAME}-${ENVIRONMENT}"

print_status "Creating Entra ID App Registration: $APP_REGISTRATION_NAME"

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    print_error "Azure CLI is not installed. Please install it first:"
    print_error "https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

# Check if logged in to Azure
print_status "Checking Azure authentication..."
if ! az account show &> /dev/null; then
    print_warning "Not logged in to Azure. Please login first."
    print_status "Running 'az login'..."
    az login
    if [[ $? -ne 0 ]]; then
        print_error "Failed to login to Azure"
        exit 1
    fi
fi

ACCOUNT_INFO=$(az account show --query "{subscriptionId:id, tenantId:tenantId, user:user.name}" -o json)
SUBSCRIPTION_ID=$(echo "$ACCOUNT_INFO" | jq -r '.subscriptionId')
TENANT_ID=$(echo "$ACCOUNT_INFO" | jq -r '.tenantId')
USER_NAME=$(echo "$ACCOUNT_INFO" | jq -r '.user')

print_success "Logged in as: $USER_NAME"
print_status "Subscription: $SUBSCRIPTION_ID"
print_status "Tenant: $TENANT_ID"

# Convert reply URLs to array format for Azure CLI
if [[ -n "$REPLY_URLS" ]]; then
    IFS=',' read -ra REPLY_URL_ARRAY <<< "$REPLY_URLS"
    REPLY_URLS_JSON=$(printf '%s\n' "${REPLY_URL_ARRAY[@]}" | jq -R . | jq -s .)
else
    REPLY_URLS_JSON="[]"
fi

# Create the app registration
print_status "Creating app registration..."

# Check if app registration already exists
EXISTING_APP=$(az ad app list --display-name "$APP_REGISTRATION_NAME" --query "[0].appId" -o tsv 2>/dev/null || echo "")

if [[ -n "$EXISTING_APP" && "$EXISTING_APP" != "null" ]]; then
    print_warning "App registration '$APP_REGISTRATION_NAME' already exists with ID: $EXISTING_APP"
    APP_ID="$EXISTING_APP"
else
    # Create new app registration
    CREATE_RESULT=$(az ad app create \
        --display-name "$APP_REGISTRATION_NAME" \
        --sign-in-audience "AzureADMyOrg" \
        --web-redirect-uris $REPLY_URLS_JSON \
        --query "{appId:appId, objectId:id}" -o json)

    if [[ $? -ne 0 ]]; then
        print_error "Failed to create app registration"
        exit 1
    fi

    APP_ID=$(echo "$CREATE_RESULT" | jq -r '.appId')
    OBJECT_ID=$(echo "$CREATE_RESULT" | jq -r '.objectId')

    print_success "App Registration created successfully!"
    print_success "Application ID: $APP_ID"
    print_success "Object ID: $OBJECT_ID"

    # Create Service Principal
    print_status "Creating service principal..."
    SP_RESULT=$(az ad sp create --id "$APP_ID" --query "id" -o tsv)
    
    if [[ $? -eq 0 ]]; then
        print_success "Service Principal created: $SP_RESULT"
    else
        print_warning "Service Principal creation failed or already exists"
    fi
fi

# Generate configuration information
print_success "=== Configuration Information ==="
echo "Application ID: $APP_ID"
echo "Tenant ID: $TENANT_ID"
echo "Issuer URL: https://login.microsoftonline.com/$TENANT_ID/v2.0"
echo "JWKS URI: https://login.microsoftonline.com/$TENANT_ID/discovery/v2.0/keys"
echo "Authorization Endpoint: https://login.microsoftonline.com/$TENANT_ID/oauth2/v2.0/authorize"
echo "Token Endpoint: https://login.microsoftonline.com/$TENANT_ID/oauth2/v2.0/token"

print_success "=== Next Steps ==="
echo "1. Update your Bicep parameters file with the Application ID: $APP_ID"
echo "2. Configure API permissions if needed in the Azure Portal"
echo "3. Deploy your infrastructure with authentication enabled"

# Create JSON configuration file
CONFIG_FILE="auth-config-$ENVIRONMENT.json"
cat > "$CONFIG_FILE" << EOF
{
  "applicationId": "$APP_ID",
  "tenantId": "$TENANT_ID",
  "issuerUrl": "https://login.microsoftonline.com/$TENANT_ID/v2.0",
  "jwksUri": "https://login.microsoftonline.com/$TENANT_ID/discovery/v2.0/keys",
  "authorizationEndpoint": "https://login.microsoftonline.com/$TENANT_ID/oauth2/v2.0/authorize",
  "tokenEndpoint": "https://login.microsoftonline.com/$TENANT_ID/oauth2/v2.0/token"
}
EOF

print_success "Configuration saved to: $CONFIG_FILE"

# Update the parameters file if it exists
PARAM_FILE="../parameters/${ENVIRONMENT}.parameters.json"
if [[ -f "$PARAM_FILE" ]]; then
    print_status "Updating parameter file: $PARAM_FILE"
    
    # Create backup
    cp "$PARAM_FILE" "${PARAM_FILE}.backup"
    
    # Update the entraAppId parameter
    jq --arg appId "$APP_ID" '.parameters.entraAppId.value = $appId' "$PARAM_FILE" > "${PARAM_FILE}.tmp" && mv "${PARAM_FILE}.tmp" "$PARAM_FILE"
    
    print_success "Parameter file updated with Application ID"
    print_status "Backup saved as: ${PARAM_FILE}.backup"
else
    print_warning "Parameter file not found: $PARAM_FILE"
    print_warning "Please manually update your parameter file with the Application ID: $APP_ID"
fi

print_success "Entra ID App Registration setup completed!"