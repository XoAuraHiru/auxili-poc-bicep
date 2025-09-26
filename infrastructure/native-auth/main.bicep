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

var normalizedOrg = toLower(replace(replace(orgName, '-', ''), '_', ''))
var normalizedService = toLower(replace(replace(serviceCode, '-', ''), '_', ''))
var uniqueSuffix = substring(uniqueString(resourceGroup().id, normalizedService), 0, 6)
var envLower = toLower(environment)

var naming = {
  storage: 'st${normalizedOrg}${normalizedService}${envLower}${uniqueSuffix}'
  functionApp: 'func-${normalizedOrg}-${normalizedService}-${envLower}-${uniqueSuffix}'
  appServicePlan: 'plan-${normalizedOrg}-${normalizedService}-${envLower}'
  appInsights: 'ai-${normalizedOrg}-${normalizedService}-${envLower}'
  logAnalytics: 'log-${normalizedOrg}-${normalizedService}-${envLower}'
  apim: 'apim-${normalizedOrg}-${normalizedService}-${envLower}-${uniqueSuffix}'
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
module appInsights '../modules/app-insights.bicep' = {
  name: 'appInsights'
  params: {
    location: location
    appInsightsName: naming.appInsights
    logAnalyticsWorkspaceId: logAnalytics.id
    environment: envLower
  }
}

// Storage account backing the Function App
module nativeAuthStorage '../modules/storage.bicep' = {
  name: 'nativeAuthStorage'
  params: {
    location: location
    storageAccountName: naming.storage
    redundancy: currentConfig.storageRedundancy
    enablePrivateEndpoints: enablePrivateEndpoints
    environment: envLower
  }
}

// Linux Function App hosting the native authentication API
module nativeAuthFunction '../modules/function-app.bicep' = {
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
  }
}

// API Management instance dedicated to the native auth service
module nativeAuthApim '../modules/apim.bicep' = {
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

// Expose the Function App endpoints through API Management
module nativeAuthApi '../modules/native-auth-apim.bicep' = {
  name: 'nativeAuthApi'
  params: {
    apimName: nativeAuthApim.outputs.apimName
    nativeFunctionAppHostName: nativeAuthFunction.outputs.functionAppHostName
    nativeFunctionAppName: nativeAuthFunction.outputs.functionAppName
    apiDisplayName: 'Native Auth Service'
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
