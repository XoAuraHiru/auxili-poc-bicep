@description('Location for the Function App')
param location string

@description('Name of the Function App')
param functionAppName string

@description('Name of the App Service Plan')
param appServicePlanName string

@description('App Service Plan SKU')
param appServicePlanSku string

@description('App Service Plan tier')  
param appServicePlanTier string

@description('Storage Account name for Function App')
param storageAccountName string

@description('Application Insights connection string')
param appInsightsConnectionString string

@description('Application Insights instrumentation key')
param appInsightsInstrumentationKey string

@description('Environment tag')
param environment string

@description('Additional app settings to configure on the Function App')
param additionalAppSettings array = []

// App Service Plan
resource appServicePlan 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: appServicePlanSku
    tier: appServicePlanTier
  }
  kind: 'functionapp'
  properties: {
    reserved: true // Linux
    elasticScaleEnabled: appServicePlanTier == 'ElasticPremium'
  }
  tags: {
    Environment: environment
    ResourceType: 'Compute'
  }
}

resource functionApp 'Microsoft.Web/sites@2022-09-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      alwaysOn: appServicePlanTier != 'Dynamic'
      scmMinTlsVersion: '1.2'
      use32BitWorkerProcess: false
      appSettings: concat([
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};AccountKey=${listKeys(resourceId('Microsoft.Storage/storageAccounts', storageAccountName), '2023-01-01').keys[0].value};EndpointSuffix=core.windows.net'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};AccountKey=${listKeys(resourceId('Microsoft.Storage/storageAccounts', storageAccountName), '2023-01-01').keys[0].value};EndpointSuffix=core.windows.net'
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(functionAppName)
        }
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: appInsightsInstrumentationKey
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'NODE_ENV'
          value: environment
        }
      ], additionalAppSettings)
    }
    publicNetworkAccess: 'Enabled'
  }
  tags: {
    Environment: environment
    ResourceType: 'Function'
  }
}

// CORS configuration for development
resource functionAppCors 'Microsoft.Web/sites/config@2022-09-01' = if (environment == 'dev') {
  name: 'web'
  parent: functionApp
  properties: {
    cors: {
      allowedOrigins: [
        '*'  // Allow all origins for development
      ]
    }
  }
}

// Outputs
output functionAppName string = functionApp.name
output functionAppId string = functionApp.id
output functionAppHostName string = functionApp.properties.defaultHostName
output functionAppPrincipalId string = functionApp.identity.principalId
