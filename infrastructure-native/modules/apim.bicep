@description('Location for APIM')
param location string

@description('APIM service name')
param apimName string

@description('APIM SKU')
param apimSku string

@description('Publisher email')
param publisherEmail string

@description('Publisher name')
param publisherName string

@description('Environment tag')
param environment string

// API Management
resource apiManagement 'Microsoft.ApiManagement/service@2023-05-01-preview' = {
  name: apimName
  location: location
  sku: {
    name: apimSku
    capacity: apimSku == 'Consumption' ? 0 : 1
  }
  properties: {
    publisherEmail: publisherEmail
    publisherName: publisherName
    notificationSenderEmail: 'apimgmt-noreply@mail.windowsazure.com'
    // Security improvements
    customProperties: {
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Protocols.Tls10': 'false'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Protocols.Tls11': 'false'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Tls10': 'false'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Tls11': 'false'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Ssl30': 'false'
    }
  }
  identity: {
    // APIM Consumption tier does not support Managed Identity
    type: apimSku == 'Consumption' ? 'None' : 'SystemAssigned'
  }
  tags: {
    Environment: environment
    ResourceType: 'API Gateway'
  }
}

// Global Policy for APIM
resource globalPolicy 'Microsoft.ApiManagement/service/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: apiManagement
  properties: {
    value: '''
    <policies>
      <inbound>
        <set-header name="X-Powered-By" exists-action="delete" />
        <set-header name="Server" exists-action="delete" />
      </inbound>
      <backend>
        <forward-request />
      </backend>
      <outbound>
        <set-header name="X-Content-Type-Options" exists-action="override">
          <value>nosniff</value>
        </set-header>
        <set-header name="X-Frame-Options" exists-action="override">
          <value>DENY</value>
        </set-header>
        <set-header name="Strict-Transport-Security" exists-action="override">
          <value>max-age=31536000; includeSubDomains</value>
        </set-header>
      </outbound>
      <on-error />
    </policies>
    '''
  }
}

// Outputs
output apimName string = apiManagement.name
output apimId string = apiManagement.id
output gatewayUrl string = apiManagement.properties.gatewayUrl
