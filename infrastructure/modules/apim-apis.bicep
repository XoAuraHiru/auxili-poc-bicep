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

@description('Protected API policy from auth module')
param protectedApiPolicy string

@description('Public API policy from auth module')
param publicApiPolicy string

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
    // Function host has empty routePrefix; include collection segment so item ops map correctly
    serviceUrl: 'https://${productFunctionAppHostName}/products'
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
    // Urls are relative to API base path "products"; remove duplicated segment
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

resource createProductOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'create-product'
  parent: productApi
  properties: {
    displayName: 'Create Product'
    method: 'POST'
    // Root collection path (POST /products)
    urlTemplate: '/'
  }
}

resource productHealthOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'product-health'
  parent: productApi
  properties: {
    displayName: 'Health'
    method: 'GET'
    urlTemplate: '/health'
  }
}

// User API (similar pattern)
resource userApi 'Microsoft.ApiManagement/service/apis@2023-05-01-preview' = {
  name: 'users-api'
  parent: apiManagement
  properties: {
    displayName: 'Users API'
    description: 'API for user management'
    // Include collection segment to align backend path
    serviceUrl: 'https://${userFunctionAppHostName}/users'
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

resource userHealthOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'user-health'
  parent: userApi
  properties: {
    displayName: 'Health'
    method: 'GET'
    urlTemplate: '/health'
  }
}

// Product API Policy - Authentication + Function Key
resource productApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: productApi
  properties: {
    value: replace(protectedApiPolicy, '  <inbound>\n    <base />', '''  <inbound>
    <base />
    <!-- Function App Authentication -->
    <set-header name="x-functions-key" exists-action="override">
      <value>${listkeys('${productFunctionApp.id}/host/default', '2022-09-01').functionKeys.default}</value>
    </set-header>''')
  }
}

// User API Policy - Authentication + Function Key  
resource userApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: userApi
  properties: {
    value: replace(protectedApiPolicy, '  <inbound>\n    <base />', '''  <inbound>
    <base />
    <!-- Function App Authentication -->
    <set-header name="x-functions-key" exists-action="override">
      <value>${listkeys('${userFunctionApp.id}/host/default', '2022-09-01').functionKeys.default}</value>
    </set-header>''')
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

resource ordersHealthOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'orders-health'
  parent: ordersApi
  properties: {
    displayName: 'Health'
    method: 'GET'
    urlTemplate: '/health'
  }
}

// Orders API Policy - Authentication + Function Key
resource ordersApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: ordersApi
  properties: {
    value: replace(protectedApiPolicy, '  <inbound>\n    <base />', '''  <inbound>
    <base />
    <!-- Function App Authentication -->
    <set-header name="x-functions-key" exists-action="override">
      <value>${listkeys('${ordersFunctionApp.id}/host/default', '2022-09-01').functionKeys.default}</value>
    </set-header>''')
  }
}

// Authentication API (routes to User Function App)
resource authApi 'Microsoft.ApiManagement/service/apis@2023-05-01-preview' = {
  name: 'auth-api'
  parent: apiManagement
  properties: {
    displayName: 'Authentication API'
    description: 'API for user authentication and authorization'
    serviceUrl: 'https://${userFunctionAppHostName}/auth'
    path: 'auth'
    protocols: ['https']
    subscriptionRequired: environment != 'dev'
    isCurrent: true
  }
}

// Authentication API Operations - these should be public (no JWT required for sign in/up)
resource signInOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'signin'
  parent: authApi
  properties: {
    displayName: 'Sign In'
    method: 'POST'
    urlTemplate: '/signin'
  }
}

resource signUpOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'signup'
  parent: authApi
  properties: {
    displayName: 'Sign Up'
    method: 'POST'
    urlTemplate: '/signup'
  }
}

resource keepAliveOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'keepalive'
  parent: authApi
  properties: {
    displayName: 'Keep Alive'
    method: 'GET'
    urlTemplate: '/keepalive'
  }
}

resource validateTokenOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'validate'
  parent: authApi
  properties: {
    displayName: 'Validate Token'
    method: 'POST'
    urlTemplate: '/validate'
  }
}

resource getProfileOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'me'
  parent: authApi
  properties: {
    displayName: 'Get Profile'
    method: 'GET'
    urlTemplate: '/me'
  }
}

// Auth API Policies - we need function key injection for this API too
resource authApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: authApi
  properties: {
    value: replace(publicApiPolicy, '  <inbound>\n    <base />', '  <inbound>\n    <base />\n    <set-backend-service base-url="https://${userFunctionAppHostName}/auth?code=${listkeys('${userFunctionApp.id}/host/default/', '2022-09-01').functionKeys.default}" />')
  }
}

// Auth endpoint-specific policies
resource signInPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: signInOperation
  properties: {
    value: publicApiPolicy
  }
}

resource signUpPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: signUpOperation
  properties: {
    value: publicApiPolicy
  }
}

// Keep alive and validate token operations can be public or protected - making them public for flexibility
resource keepAlivePolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: keepAliveOperation
  properties: {
    value: publicApiPolicy
  }
}

resource validateTokenPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: validateTokenOperation
  properties: {
    value: publicApiPolicy
  }
}

resource getProfilePolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: getProfileOperation
  properties: {
    value: publicApiPolicy
  }
}

// Health endpoints should be public - create specific policy for health operations
resource productHealthPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: productHealthOperation
  properties: {
    value: publicApiPolicy
  }
}

resource userHealthPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: userHealthOperation
  properties: {
    value: publicApiPolicy
  }
}

resource ordersHealthPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: ordersHealthOperation
  properties: {
    value: publicApiPolicy
  }
}

// Outputs
output productApiName string = productApi.name
output userApiName string = userApi.name
output ordersApiName string = ordersApi.name
output authApiName string = authApi.name
