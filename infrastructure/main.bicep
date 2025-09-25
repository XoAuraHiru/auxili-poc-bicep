@description('Environment (dev, staging, prod)')
param environment string = 'dev'

@description('Location for all resources')
param location string = resourceGroup().location

@description('Organization name')
param orgName string = 'auxili'

@description('Project name')
param projectName string = 'microservices'

@description('Admin email for APIM')
param apimAdminEmail string = 'admin@auxili.com'

// Note: Private endpoints and developer IP are controlled per-module via env config

// Generate unique suffix for globally unique resources
var uniqueSuffix = substring(uniqueString(resourceGroup().id), 0, 8)

// Resource naming convention following Azure best practices
var naming = {
  // Storage accounts (must be globally unique, lowercase, no special chars)
  productStorage: 'st${orgName}prod${environment}${uniqueSuffix}'
  userStorage: 'st${orgName}user${environment}${uniqueSuffix}'
  ordersStorage: 'st${orgName}ord${environment}${uniqueSuffix}'
  
  // Function Apps (must be globally unique)
  productFunction: 'func-${orgName}-product-${environment}-${uniqueSuffix}'
  userFunction: 'func-${orgName}-user-${environment}-${uniqueSuffix}'
  ordersFunction: 'func-${orgName}-orders-${environment}-${uniqueSuffix}'
  
  // Other resources
  appInsights: 'ai-${orgName}-${projectName}-${environment}'
  logAnalytics: 'log-${orgName}-${projectName}-${environment}'
  apim: 'apim-${orgName}-${environment}-${uniqueSuffix}'
  
  // App Service Plans
  productPlan: 'plan-${orgName}-product-${environment}'
  userPlan: 'plan-${orgName}-user-${environment}'
  ordersPlan: 'plan-${orgName}-orders-v3-${environment}'
}

// Environment-specific configuration
var envConfig = {
  dev: {
    apimSku: 'Consumption'
    functionAppSku: 'Y1'
    functionAppTier: 'Dynamic'
    enableAuth: false
  enablePrivateEndpoints: false
    storageRedundancy: 'Standard_LRS'
  }
  staging: {
    apimSku: 'Developer'
    functionAppSku: 'EP1'
    functionAppTier: 'ElasticPremium'
    enableAuth: true
  enablePrivateEndpoints: false
    storageRedundancy: 'Standard_GRS'
  }
  prod: {
    apimSku: 'Standard'
    functionAppSku: 'EP1' 
    functionAppTier: 'ElasticPremium'
    enableAuth: true
  enablePrivateEndpoints: true
    storageRedundancy: 'Standard_GRS'
  }
}

// Get current environment config
var currentConfig = envConfig[environment]

// Log Analytics Workspace
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: naming.logAnalytics
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: environment == 'prod' ? 90 : 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
  tags: {
    Environment: environment
    Project: projectName
    Organization: orgName
  }
}

// Application Insights
module appInsights 'modules/app-insights.bicep' = {
  name: 'appInsights'
  params: {
    location: location
    appInsightsName: naming.appInsights
    logAnalyticsWorkspaceId: logAnalytics.id
    environment: environment
  }
}

// Storage Accounts
module productStorage 'modules/storage.bicep' = {
  name: 'productStorage'
  params: {
    location: location
    storageAccountName: naming.productStorage
    redundancy: currentConfig.storageRedundancy
    enablePrivateEndpoints: currentConfig.enablePrivateEndpoints
    environment: environment
  }
}

module userStorage 'modules/storage.bicep' = {
  name: 'userStorage'
  params: {
    location: location
    storageAccountName: naming.userStorage
    redundancy: currentConfig.storageRedundancy
    enablePrivateEndpoints: currentConfig.enablePrivateEndpoints
    environment: environment
  }
}

module ordersStorage 'modules/storage.bicep' = {
  name: 'ordersStorage'
  params: {
    location: location
    storageAccountName: naming.ordersStorage
    redundancy: currentConfig.storageRedundancy
    enablePrivateEndpoints: currentConfig.enablePrivateEndpoints
    environment: environment
  }
}

// Product Function App
module productFunction 'modules/function-app.bicep' = {
  name: 'productFunction'
  params: {
    location: location
    functionAppName: naming.productFunction
    appServicePlanName: naming.productPlan
    appServicePlanSku: currentConfig.functionAppSku
    appServicePlanTier: currentConfig.functionAppTier
    storageAccountName: productStorage.outputs.storageAccountName
    appInsightsConnectionString: appInsights.outputs.connectionString
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    environment: environment
  }
  // No explicit dependsOn needed; references to productStorage/appInsights outputs create implicit dependency
}

// User Function App  
module userFunction 'modules/function-app.bicep' = {
  name: 'userFunction'
  params: {
    location: location
    functionAppName: naming.userFunction
    appServicePlanName: naming.userPlan
    appServicePlanSku: currentConfig.functionAppSku
    appServicePlanTier: currentConfig.functionAppTier
    storageAccountName: userStorage.outputs.storageAccountName
    appInsightsConnectionString: appInsights.outputs.connectionString
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    environment: environment
  }
  // Implicit dependency via referenced outputs
}

// Orders Function App (v3)
module ordersFunction 'modules/function-app-v3.bicep' = {
  name: 'ordersFunction'
  params: {
    location: location
    functionAppName: naming.ordersFunction
    appServicePlanName: naming.ordersPlan
    appServicePlanSku: currentConfig.functionAppSku
    appServicePlanTier: currentConfig.functionAppTier
    storageAccountName: ordersStorage.outputs.storageAccountName
    appInsightsConnectionString: appInsights.outputs.connectionString
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    environment: environment
  }
  // Implicit dependency via referenced outputs
}

// API Management
module apim 'modules/apim.bicep' = {
  name: 'apim'
  params: {
    location: location
    apimName: naming.apim
    apimSku: currentConfig.apimSku
    publisherEmail: apimAdminEmail
    publisherName: '${orgName} ${environment}'
    environment: environment
  }
}

// APIM API Configurations (connect Function Apps to APIM)
module apimApis 'modules/apim-apis.bicep' = {
  name: 'apimApis'
  params: {
    apimName: apim.outputs.apimName
    productFunctionAppHostName: productFunction.outputs.functionAppHostName
    productFunctionAppName: productFunction.outputs.functionAppName 
    userFunctionAppHostName: userFunction.outputs.functionAppHostName
    userFunctionAppName: userFunction.outputs.functionAppName
    ordersFunctionAppHostName: ordersFunction.outputs.functionAppHostName
    ordersFunctionAppName: ordersFunction.outputs.functionAppName
    environment: environment
  }
}

// Outputs for use in deployment scripts
output resourceGroupName string = resourceGroup().name
output productFunctionAppName string = productFunction.outputs.functionAppName
output userFunctionAppName string = userFunction.outputs.functionAppName
output ordersFunctionAppName string = ordersFunction.outputs.functionAppName
output apimName string = apim.outputs.apimName
output apimGatewayUrl string = apim.outputs.gatewayUrl
output productFunctionAppHostName string = productFunction.outputs.functionAppHostName
output userFunctionAppHostName string = userFunction.outputs.functionAppHostName
output ordersFunctionAppHostName string = ordersFunction.outputs.functionAppHostName
output appInsightsName string = appInsights.outputs.appInsightsName
