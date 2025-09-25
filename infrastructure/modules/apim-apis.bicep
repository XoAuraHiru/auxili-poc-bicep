@description('APIM service name')
param apimName string

@description('Product Function App hostname')
param productFunctionAppHostName string

@description('Product Function App name for key retrieval')
param productFunctionAppName string

@description('User Function App hostname') 
param userFunctionAppHostName string

@description('User Function App name for key retrieval')
param userFunctionAppName string

@description('Orders Function App hostname')
param ordersFunctionAppHostName string

@description('Orders Function App name for key retrieval')
param ordersFunctionAppName string

@description('Environment')
param environment string

// Get reference to existing APIM
resource apiManagement 'Microsoft.ApiManagement/service@2023-05-01-preview' existing = {
  name: apimName
}

// Get existing Function Apps to retrieve keys
resource productFunctionApp 'Microsoft.Web/sites@2022-09-01' existing = {
  name: productFunctionAppName
}

resource userFunctionApp 'Microsoft.Web/sites@2022-09-01' existing = {
  name: userFunctionAppName  
}

resource ordersFunctionApp 'Microsoft.Web/sites@2022-09-01' existing = {
  name: ordersFunctionAppName
}

// Product API
resource productApi 'Microsoft.ApiManagement/service/apis@2023-05-01-preview' = {
  name: 'products-api'
  parent: apiManagement
  properties: {
    displayName: 'Products API'
    description: 'API for product management'
    serviceUrl: 'https://${productFunctionAppHostName}/api'
    path: 'products'
    protocols: ['https']
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
    urlTemplate: '/products/{id}'
    templateParameters: [
      {
        name: 'id'
        type: 'string'
        required: true
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
    urlTemplate: '/products'
  }
}

resource productHealthOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'product-health'
  parent: productApi
  properties: {
    displayName: 'Health'
    method: 'GET'
    urlTemplate: '/products/health'
  }
}

// User API (similar pattern)
resource userApi 'Microsoft.ApiManagement/service/apis@2023-05-01-preview' = {
  name: 'users-api'
  parent: apiManagement
  properties: {
    displayName: 'Users API'
    description: 'API for user management'
    serviceUrl: 'https://${userFunctionAppHostName}/api'
    path: 'users'
    protocols: ['https']
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
    urlTemplate: '/users/{id}'
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
    urlTemplate: '/users'
  }
}

resource listUsersOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'list-users'
  parent: userApi
  properties: {
    displayName: 'List Users'
    method: 'GET'
    urlTemplate: '/users'
  }
}

resource userHealthOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'user-health'
  parent: userApi
  properties: {
    displayName: 'Health'
    method: 'GET'
    urlTemplate: '/users/health'
  }
}

// API Policies with dynamic function key retrieval
resource productApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: productApi
  properties: {
    value: '''
    <policies>
      <inbound>
        <base />
        <set-header name="x-functions-key" exists-action="override">
          <value>${listkeys('${productFunctionApp.id}/host/default', '2022-09-01').functionKeys.default}</value>
        </set-header>
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
        <set-header name="x-functions-key" exists-action="override">
          <value>${listkeys('${userFunctionApp.id}/host/default', '2022-09-01').functionKeys.default}</value>
        </set-header>
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

// Orders API and policy (similar pattern)
resource ordersApi 'Microsoft.ApiManagement/service/apis@2023-05-01-preview' = {
  name: 'orders-api'
  parent: apiManagement
  properties: {
    displayName: 'Orders API (v3)'
    description: 'API for order management using Functions v3'
    serviceUrl: 'https://${ordersFunctionAppHostName}/api'
    path: 'orders'
    protocols: ['https']
    subscriptionRequired: environment != 'dev'
    isCurrent: true
  }
}

resource getOrderOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'get-order'
  parent: ordersApi
  properties: {
    displayName: 'Get Order'
    method: 'GET'
    urlTemplate: '/orders/{id}'
    templateParameters: [
      {
        name: 'id'
        type: 'string'
        required: true
      }
    ]
  }
}

resource ordersHealthOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'orders-health'
  parent: ordersApi
  properties: {
    displayName: 'Health'
    method: 'GET'
    urlTemplate: '/orders/health'
  }
}

resource ordersApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: ordersApi
  properties: {
    value: '''
    <policies>
      <inbound>
        <base />
        <set-header name="x-functions-key" exists-action="override">
          <value>${listkeys('${ordersFunctionApp.id}/host/default', '2022-09-01').functionKeys.default}</value>
        </set-header>
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
output ordersApiName string = ordersApi.name
