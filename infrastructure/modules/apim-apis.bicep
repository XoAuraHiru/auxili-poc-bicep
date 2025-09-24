@description('APIM service name')
param apimName string

@description('Product Function App hostname')
param productFunctionAppHostName string

@description('User Function App hostname')
param userFunctionAppHostName string

@description('Environment')
param environment string

// Get reference to existing APIM
resource apiManagement 'Microsoft.ApiManagement/service@2023-05-01-preview' existing = {
  name: apimName
}

// Product API
resource productApi 'Microsoft.ApiManagement/service/apis@2023-05-01-preview' = {
  name: 'products-api'
  parent: apiManagement
  properties: {
    displayName: 'Products API'
    description: 'API for product management'
    // Point directly to the Functions route base
    serviceUrl: 'https://${productFunctionAppHostName}/api/products'
    path: 'products'
    protocols: [
      'https'
    ]
    subscriptionRequired: environment != 'dev'
    isCurrent: true
  }
}

// Product API Operations
resource getProductOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'get-product'
  parent: productApi
  properties: {
    displayName: 'Get Product'
    method: 'GET'
    urlTemplate: '/{id}'
    templateParameters: [
      {
        name: 'id'
        type: 'string'
        required: true
      }
    ]
    responses: [
      {
        statusCode: 200
        description: 'Product details'
        headers: [
          {
            name: 'Content-Type'
            type: 'string'
            values: ['application/json']
          }
        ]
      }
    ]
  }
}

resource createProductOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'create-product'
  parent: productApi
  properties: {
    displayName: 'Create Product'
    method: 'POST'
    urlTemplate: '/'
    request: {
      headers: [
        {
          name: 'Content-Type'
          type: 'string'
          values: ['application/json']
          required: true
        }
      ]
    }
    responses: [
      {
        statusCode: 201
        description: 'Product created'
      }
    ]
  }
}

// Product Health
resource productHealthOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'product-health'
  parent: productApi
  properties: {
    displayName: 'Health'
    method: 'GET'
    urlTemplate: '/health'
    responses: [
      {
        statusCode: 200
        description: 'Health status'
      }
    ]
  }
}

// User API
resource userApi 'Microsoft.ApiManagement/service/apis@2023-05-01-preview' = {
  name: 'users-api'
  parent: apiManagement
  properties: {
    displayName: 'Users API'
    description: 'API for user management'
    // Point directly to the Functions route base
    serviceUrl: 'https://${userFunctionAppHostName}/api/users'
    path: 'users'
    protocols: [
      'https'
    ]
    subscriptionRequired: environment != 'dev'
    isCurrent: true
  }
}

// User API Operations
resource getUserOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'get-user'
  parent: userApi
  properties: {
    displayName: 'Get User'
    method: 'GET'
    urlTemplate: '/{id}'
    templateParameters: [
      {
        name: 'id'
        type: 'string'
        required: true
      }
    ]
  }
}

resource createUserOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'create-user'
  parent: userApi
  properties: {
    displayName: 'Create User'
    method: 'POST'
    urlTemplate: '/'
  }
}

resource listUsersOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'list-users'
  parent: userApi
  properties: {
    displayName: 'List Users'
    method: 'GET'
    urlTemplate: '/'
  }
}

// User Health
resource userHealthOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'user-health'
  parent: userApi
  properties: {
    displayName: 'Health'
    method: 'GET'
    urlTemplate: '/health'
    responses: [
      {
        statusCode: 200
        description: 'Health status'
      }
    ]
  }
}

// API Policies for rate limiting and security
resource productApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: productApi
  properties: {
    value: '''
    <policies>
      <inbound>
        <base />
        <rate-limit calls="100" renewal-period="60" />
        <cors>
          <allowed-origins>
            <origin>*</origin>
          </allowed-origins>
          <allowed-methods>
            <method>GET</method>
            <method>POST</method>
            <method>OPTIONS</method>
          </allowed-methods>
        </cors>
      </inbound>
      <backend>
        <base />
      </backend>
      <outbound>
        <base />
      </outbound>
      <on-error>
        <base />
      </on-error>
    </policies>
    '''
  }
}

resource userApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: userApi
  properties: {
    value: '''
    <policies>
      <inbound>
        <base />
        <rate-limit calls="100" renewal-period="60" />
        <cors>
          <allowed-origins>
            <origin>*</origin>
          </allowed-origins>
          <allowed-methods>
            <method>GET</method>
            <method>POST</method>
            <method>OPTIONS</method>
          </allowed-methods>
        </cors>
      </inbound>
      <backend>
        <base />
      </backend>
      <outbound>
        <base />
      </outbound>
      <on-error>
        <base />
      </on-error>
    </policies>
    '''
  }
}

// Outputs
output productApiName string = productApi.name
output userApiName string = userApi.name
