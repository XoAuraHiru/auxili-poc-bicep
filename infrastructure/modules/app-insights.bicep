@description('Location for Application Insights')
param location string

@description('Name of Application Insights')
param appInsightsName string

@description('Log Analytics Workspace ID')
param logAnalyticsWorkspaceId string

@description('Environment tag')
param environment string

// Application Insights
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspaceId
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
  tags: {
    Environment: environment
    ResourceType: 'Monitoring'
  }
}

// Outputs
output appInsightsName string = appInsights.name
output instrumentationKey string = appInsights.properties.InstrumentationKey
output connectionString string = appInsights.properties.ConnectionString
