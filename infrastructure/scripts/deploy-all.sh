#!/bin/bash
set -e

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Get the infrastructure directory (parent of scripts)
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

RESOURCE_GROUP="rg-auxili-poc-v2-dev"

echo "Starting full deployment..."
echo "Script directory: $SCRIPT_DIR"
echo "Infrastructure directory: $INFRA_DIR"

echo "Step 1: Deploy infrastructure..."
"$SCRIPT_DIR/deploy-infrastructure.sh"

echo "Step 2: Deploy function code..."
"$SCRIPT_DIR/deploy-functions.sh"

echo "Step 3: Update APIM with function keys..."
cd "$INFRA_DIR"
az deployment group create \
  -g "$RESOURCE_GROUP" \
  -f main.bicep \
  -p @parameters/dev.parameters.json

echo "Full deployment complete!"

echo "Testing endpoints..."
if [ -f "$SCRIPT_DIR/test-endpoints.sh" ]; then
    "$SCRIPT_DIR/test-endpoints.sh"
fi