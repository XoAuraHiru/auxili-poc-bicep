#!/bin/bash
set -e

echo "Starting full deployment..."

echo "Step 1: Deploy infrastructure..."
./scripts/deploy-infrastructure.sh

echo "Step 2: Deploy function code..."
./scripts/deploy-functions.sh

echo "Step 3: Update APIM with function keys..."
RESOURCE_GROUP="rg-auxili-poc-v2-dev"
az deployment group create \
  -g $RESOURCE_GROUP \
  -f infrastructure/main.bicep \
  -p @infrastructure/parameters/dev.parameters.json

echo "Full deployment complete!"