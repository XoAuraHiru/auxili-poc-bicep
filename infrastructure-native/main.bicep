@description('Deployment environment identifier (dev, staging, prod).')
@allowed([
  'dev'
  'staging'
  'prod'
])
param environment string = 'dev'

@description('Azure region for all resources. Defaults to the resource group\'s location.')
param location string = resourceGroup().location

@description('Short organization label used for resource naming (alphanumeric only).')
param orgName string = 'auxili'

@description('Short service code used in resource names to keep them unique.')
param serviceCode string = 'nat'

@description('Administrator email address for API Management publisher settings.')
param apimAdminEmail string = 'admin@auxili.com'

@description('Whether to enable private endpoints on supporting services (recommended for prod).')
param enablePrivateEndpoints bool = false

@description('Whether JWT enforcement should be enabled on APIM for native auth endpoints.')
param enableAuth bool = false

@description('Primary Entra ID application (client) ID accepted by the API policies.')
param applicationId string = '00000000-0000-0000-0000-000000000000'

@description('Azure AD tenant ID used for issuer discovery and JWKS resolution.')
param tenantId string = tenant().tenantId

@description('JWT issuer URL override if different from the default cloud authority.')
param issuerUrl string = '${az.environment().authentication.loginEndpoint}${tenantId}/v2.0'

@description('JWKS URI override for JWT key discovery.')
param jwksUri string = '${az.environment().authentication.loginEndpoint}${tenantId}/discovery/v2.0/keys'

@description('Additional audiences accepted during JWT validation.')
param additionalAudiences array = []

@description('Delegated scopes that must be present on protected calls.')
param requiredScopes array = []

@description('App roles that must be present on protected calls.')
param requiredRoles array = []

@description('Allowed CORS origins enforced by APIM for native auth endpoints.')
param allowedOrigins array = toLower(environment) == 'dev' ? [
  'http://localhost:3000'
  'https://oauth.pstmn.io'
] : [
  'https://oauth.pstmn.io'
]

@description('Maximum number of calls allowed per renewal window.')
param rateLimitCalls int = 120

@description('Renewal window length (seconds) for the rate limit policy.')
param rateLimitRenewalSeconds int = 60

@description('Native auth tenant subdomain used to construct CIAM native auth endpoints.')
param nativeAuthTenantSubdomain string = ''

@description('Space-delimited scopes requested during native auth flows.')
param nativeAuthScopes string = 'openid profile email offline_access'

var normalizedOrg = toLower(replace(replace(orgName, '-', ''), '_', ''))
var normalizedService = toLower(replace(replace(serviceCode, '-', ''), '_', ''))
var uniqueSuffix = substring(uniqueString(resourceGroup().id, normalizedService), 0, 6)
var envLower = toLower(environment)
var nativeAuthBaseUrl = empty(nativeAuthTenantSubdomain) ? '' : 'https://${nativeAuthTenantSubdomain}.ciamlogin.com/${nativeAuthTenantSubdomain}.onmicrosoft.com'

var naming = {
  storage: 'st${normalizedOrg}${normalizedService}${envLower}${uniqueSuffix}'
  functionApp: 'func-${normalizedOrg}-${normalizedService}-${envLower}-${uniqueSuffix}'
  appServicePlan: 'plan-${normalizedOrg}-${normalizedService}-${envLower}'
  appInsights: 'ai-${normalizedOrg}-${normalizedService}-${envLower}'
  logAnalytics: 'log-${normalizedOrg}-${normalizedService}-${envLower}'
  apim: 'apim-${normalizedOrg}-${normalizedService}-${envLower}-${uniqueSuffix}'
  profileStorage: 'st${normalizedOrg}${normalizedService}prof${envLower}${uniqueSuffix}'
  profileFunctionApp: 'func-${normalizedOrg}-${normalizedService}-profile-${envLower}-${uniqueSuffix}'
  profileAppServicePlan: 'plan-${normalizedOrg}-${normalizedService}-profile-${envLower}'
}

var envConfig = {
  dev: {
    apimSku: 'Consumption'
    functionAppSku: 'Y1'
    functionAppTier: 'Dynamic'
    storageRedundancy: 'Standard_LRS'
    logRetentionDays: 30
  }
  staging: {
    apimSku: 'Developer'
    functionAppSku: 'EP1'
    functionAppTier: 'ElasticPremium'
    storageRedundancy: 'Standard_GRS'
    logRetentionDays: 30
  }
  prod: {
    apimSku: 'Standard'
    functionAppSku: 'EP1'
    functionAppTier: 'ElasticPremium'
    storageRedundancy: 'Standard_GRS'
    logRetentionDays: 90
  }
}

var currentConfig = envConfig[envLower]

// Log Analytics Workspace used for centralized monitoring
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: naming.logAnalytics
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: currentConfig.logRetentionDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
  tags: {
    Environment: envLower
    Service: '${normalizedOrg}-${normalizedService}'
  }
}

// Application Insights connected to the workspace above
module appInsights 'modules/app-insights.bicep' = {
  name: 'appInsights'
  params: {
    location: location
    appInsightsName: naming.appInsights
    logAnalyticsWorkspaceId: logAnalytics.id
    environment: envLower
  }
}

// Storage account backing the Function App
module nativeAuthStorage 'modules/storage.bicep' = {
  name: 'nativeAuthStorage'
  params: {
    location: location
    storageAccountName: naming.storage
    redundancy: currentConfig.storageRedundancy
    enablePrivateEndpoints: enablePrivateEndpoints
    environment: envLower
  }
}

module profileStorage 'modules/storage.bicep' = {
  name: 'profileStorage'
  params: {
    location: location
    storageAccountName: naming.profileStorage
    redundancy: currentConfig.storageRedundancy
    enablePrivateEndpoints: enablePrivateEndpoints
    environment: envLower
  }
}

// Linux Function App hosting the native authentication API
module nativeAuthFunction 'modules/function-app.bicep' = {
  name: 'nativeAuthFunction'
  params: {
    location: location
    functionAppName: naming.functionApp
    appServicePlanName: naming.appServicePlan
    appServicePlanSku: currentConfig.functionAppSku
    appServicePlanTier: currentConfig.functionAppTier
    storageAccountName: nativeAuthStorage.outputs.storageAccountName
    appInsightsConnectionString: appInsights.outputs.connectionString
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    environment: envLower
    additionalAppSettings: concat([
      {
        name: 'NATIVE_AUTH_ENABLED'
        value: toLower(string(enableAuth))
      }
      {
        name: 'NATIVE_AUTH_CLIENT_ID'
        value: applicationId
      }
      {
        name: 'ENTRA_NATIVE_CLIENT_ID'
        value: applicationId
      }
      {
        name: 'NATIVE_AUTH_TENANT_ID'
        value: tenantId
      }
      {
        name: 'NATIVE_AUTH_SCOPES'
        value: nativeAuthScopes
      }
    ], empty(nativeAuthTenantSubdomain) ? [] : [
      {
        name: 'NATIVE_AUTH_TENANT_SUBDOMAIN'
        value: nativeAuthTenantSubdomain
      }
      {
        name: 'ENTRA_TENANT_SUBDOMAIN'
        value: nativeAuthTenantSubdomain
      }
    ], empty(nativeAuthBaseUrl) ? [] : [
      {
        name: 'NATIVE_AUTH_BASE_URL'
        value: nativeAuthBaseUrl
      }
    ])
  }
}

module profileFunction 'modules/function-app.bicep' = {
  name: 'profileFunction'
  params: {
    location: location
    functionAppName: naming.profileFunctionApp
    appServicePlanName: naming.profileAppServicePlan
    appServicePlanSku: currentConfig.functionAppSku
    appServicePlanTier: currentConfig.functionAppTier
    storageAccountName: profileStorage.outputs.storageAccountName
    appInsightsConnectionString: appInsights.outputs.connectionString
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    environment: envLower
  }
}

// API Management instance dedicated to the native auth service
module nativeAuthApim 'modules/apim.bicep' = {
  name: 'nativeAuthApim'
  params: {
    location: location
    apimName: naming.apim
    apimSku: currentConfig.apimSku
    publisherEmail: apimAdminEmail
    publisherName: '${orgName} Native Auth'
    environment: envLower
  }
}

module nativeAuthPolicies 'modules/auth-policies.bicep' = {
  name: 'nativeAuthPolicies'
  params: {
    applicationId: applicationId
    tenantId: tenantId
    environment: envLower
    enableAuth: enableAuth
    issuerUrl: issuerUrl
    jwksUri: jwksUri
    additionalAudiences: additionalAudiences
    requiredScopes: requiredScopes
    requiredRoles: requiredRoles
    allowedOrigins: allowedOrigins
    rateLimitCalls: rateLimitCalls
    rateLimitRenewalSeconds: rateLimitRenewalSeconds
  }
}

// Expose the Function App endpoints through API Management
module nativeAuthApi 'modules/native-auth-apim.bicep' = {
  name: 'nativeAuthApi'
  params: {
    apimName: nativeAuthApim.outputs.apimName
    nativeFunctionAppHostName: nativeAuthFunction.outputs.functionAppHostName
    nativeFunctionAppName: nativeAuthFunction.outputs.functionAppName
    apiDisplayName: 'Native Auth Service'
    publicApiPolicy: nativeAuthPolicies.outputs.publicApiPolicy
  }
}

module profileApi 'modules/profile-apim.bicep' = {
  name: 'profileApi'
  params: {
    apimName: nativeAuthApim.outputs.apimName
    profileFunctionAppHostName: profileFunction.outputs.functionAppHostName
    profileFunctionAppName: profileFunction.outputs.functionAppName
    protectedApiPolicy: nativeAuthPolicies.outputs.protectedApiPolicy
    publicApiPolicy: nativeAuthPolicies.outputs.publicApiPolicy
  }
}

// Useful outputs for deployment scripts and clients
output functionAppName string = nativeAuthFunction.outputs.functionAppName
output functionAppHostName string = nativeAuthFunction.outputs.functionAppHostName
output storageAccountName string = nativeAuthStorage.outputs.storageAccountName
output appInsightsName string = appInsights.outputs.appInsightsName
output apimName string = nativeAuthApim.outputs.apimName
output apimGatewayUrl string = nativeAuthApim.outputs.gatewayUrl
output logAnalyticsWorkspaceId string = logAnalytics.id
output profileFunctionAppName string = profileFunction.outputs.functionAppName
output profileFunctionAppHostName string = profileFunction.outputs.functionAppHostName
output profileApiName string = profileApi.outputs.profileApiName
