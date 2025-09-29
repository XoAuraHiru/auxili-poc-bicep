@description('Location for the storage account')
param location string

@description('Name of the storage account')
param storageAccountName string

@description('Storage redundancy type')
param redundancy string = 'Standard_LRS'

@description('Enable private endpoints')
param enablePrivateEndpoints bool = false

@description('Environment tag')
param environment string

// Storage Account
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: redundancy
  }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true // Functions need this
    publicNetworkAccess: enablePrivateEndpoints ? 'Disabled' : 'Enabled'
    encryption: {
      services: {
        blob: { enabled: true }
        file: { enabled: true }
        queue: { enabled: true }
        table: { enabled: true }
      }
    }
    networkAcls: enablePrivateEndpoints ? {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
    } : {
      defaultAction: 'Allow'
    }
  }
  tags: {
    Environment: environment
    ResourceType: 'Storage'
  }
}

// Output
output storageAccountName string = storageAccount.name
output storageAccountId string = storageAccount.id
