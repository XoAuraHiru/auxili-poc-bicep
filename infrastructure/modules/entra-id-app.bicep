@description('The display name of the application')
param appName string

@description('Environment tag')
param environmentName string

@description('Existing Application ID if already created')
param existingApplicationId string = ''

// Generate unique app registration name
var appRegistrationName = '${appName}-${environmentName}'

// Note: Entra ID App Registration creation via Bicep requires Microsoft.AzureActiveDirectory resource provider
// which may not be available in all subscriptions. This template provides the structure and outputs
// for manual app registration or deployment via Azure CLI/PowerShell scripts.

// For now, we'll use parameters to pass in the application details
// In production, you would create the app registration manually or via Azure CLI/PowerShell

// Outputs for use in other modules (using provided application ID or placeholder)
var applicationId = !empty(existingApplicationId) ? existingApplicationId : 'replace-with-actual-app-id'

output applicationId string = applicationId
output tenantId string = tenant().tenantId
output issuerUrl string = '${az.environment().authentication.loginEndpoint}${tenant().tenantId}/v2.0'
output jwksUri string = '${az.environment().authentication.loginEndpoint}${tenant().tenantId}/discovery/v2.0/keys'
output audience string = applicationId
output appRegistrationName string = appRegistrationName

// OAuth2 endpoints for documentation
output authorizationEndpoint string = '${az.environment().authentication.loginEndpoint}${tenant().tenantId}/oauth2/v2.0/authorize'
output tokenEndpoint string = '${az.environment().authentication.loginEndpoint}${tenant().tenantId}/oauth2/v2.0/token'
