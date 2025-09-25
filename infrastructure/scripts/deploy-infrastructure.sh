#!/bin/bash
set -e

RESOURCE_GROUP="rg-auxili-poc-v2-dev"
LOCATION="Southeast Asia"

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Get the infrastructure directory (parent of scripts)
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

echo "Script directory: $SCRIPT_DIR"
echo "Infrastructure directory: $INFRA_DIR"

echo "Creating resource group..."
az group create -n "$RESOURCE_GROUP" -l "$LOCATION"

echo "Deploying infrastructure..."
cd "$INFRA_DIR"
az deployment group create \
  -g "$RESOURCE_GROUP" \
  -f main.bicep \
  -p @parameters/dev.parameters.json

echo "Infrastructure deployment complete!"