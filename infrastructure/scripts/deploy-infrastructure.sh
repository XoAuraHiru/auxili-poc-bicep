#!/bin/bash
set -e

RESOURCE_GROUP="rg-auxili-poc-v2-dev"
LOCATION="Southeast Asia"
ENVIRONMENT="dev"

echo "Creating resource group..."
az group create -n $RESOURCE_GROUP -l "$LOCATION"

echo "Deploying infrastructure..."
az deployment group create \
  -g $RESOURCE_GROUP \
  -f infrastructure/main.bicep \
  -p @infrastructure/parameters/dev.parameters.json

echo "Infrastructure deployment complete!"