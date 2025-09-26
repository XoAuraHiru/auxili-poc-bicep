@description('Azure API Management service name')
param apimName string

@description('Function App hostname that hosts the native auth endpoints')
param nativeFunctionAppHostName string

@description('Function App name (used to retrieve host keys)')
param nativeFunctionAppName string

@description('Display name for the API inside API Management')
param apiDisplayName string = 'Native Auth API'

resource apiManagement 'Microsoft.ApiManagement/service@2023-05-01-preview' existing = {
  name: apimName
}

resource nativeFunctionApp 'Microsoft.Web/sites@2022-09-01' existing = {
  name: nativeFunctionAppName
}

resource nativeAuthApi 'Microsoft.ApiManagement/service/apis@2023-05-01-preview' = {
  name: 'native-auth-api'
  parent: apiManagement
  properties: {
    displayName: apiDisplayName
    description: 'Surfaced native authentication endpoints backed by Azure Functions.'
    serviceUrl: 'https://${nativeFunctionAppHostName}/api/auth'
    path: 'auth'
    protocols: [
      'https'
    ]
    subscriptionRequired: false
    isCurrent: true
  }
}

resource passwordSignInOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'password-signin'
  parent: nativeAuthApi
  properties: {
    displayName: 'Password Sign In'
    method: 'POST'
    urlTemplate: '/password'
    description: 'Authenticate using native username/password flow.'
  }
}

resource signupStartOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'signup-start'
  parent: nativeAuthApi
  properties: {
    displayName: 'Start Sign Up'
    method: 'POST'
    urlTemplate: '/signup/start'
    description: 'Begins the native sign-up flow and issues a verification challenge.'
  }
}

resource signupChallengeOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'signup-challenge'
  parent: nativeAuthApi
  properties: {
    displayName: 'Send Sign Up Challenge'
    method: 'POST'
    urlTemplate: '/signup/challenge'
    description: 'Sends the verification challenge to the user (for example, email OTP).'
  }
}

resource signupContinueOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'signup-continue'
  parent: nativeAuthApi
  properties: {
    displayName: 'Continue Sign Up'
    method: 'POST'
    urlTemplate: '/signup/continue'
    description: 'Completes the native sign-up verification steps.'
  }
}

resource passwordResetStartOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'password-reset-start'
  parent: nativeAuthApi
  properties: {
    displayName: 'Start Password Reset'
    method: 'POST'
    urlTemplate: '/password/reset/start'
    description: 'Begins the password reset flow and sends a verification challenge.'
  }
}

resource passwordResetContinueOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'password-reset-continue'
  parent: nativeAuthApi
  properties: {
    displayName: 'Continue Password Reset'
    method: 'POST'
    urlTemplate: '/password/reset/continue'
    description: 'Completes the password reset verification and updates the password.'
  }
}

resource healthOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'native-auth-health'
  parent: nativeAuthApi
  properties: {
    displayName: 'Health'
    method: 'GET'
    urlTemplate: '/health'
    description: 'Health probe for the native authentication function.'
  }
}

var functionHostKey = listkeys('${nativeFunctionApp.id}/host/default', '2022-09-01').functionKeys.default

var apiPolicyTemplate = '''
<policies>
  <inbound>
    <base />
    <set-header name="x-functions-key" exists-action="override">
      <value>{FUNCTION_KEY}</value>
    </set-header>
    <cors>
      <allowed-origins>
        <origin>*</origin>
      </allowed-origins>
      <allowed-methods>
        <method>GET</method>
        <method>POST</method>
        <method>OPTIONS</method>
      </allowed-methods>
      <allowed-headers>
        <header>*</header>
      </allowed-headers>
    </cors>
  </inbound>
  <backend>
    <forward-request />
  </backend>
  <outbound>
    <base />
    <set-header name="X-Powered-By" exists-action="delete" />
    <set-header name="Server" exists-action="delete" />
  </outbound>
  <on-error>
    <base />
  </on-error>
</policies>
'''

var apiPolicyValue = replace(apiPolicyTemplate, '{FUNCTION_KEY}', functionHostKey)

resource nativeAuthApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: nativeAuthApi
  properties: {
    value: apiPolicyValue
  }
}

resource healthOperationPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: healthOperation
  properties: {
    value: '''
<policies>
  <inbound>
    <base />
    <cors>
      <allowed-origins>
        <origin>*</origin>
      </allowed-origins>
      <allowed-methods>
        <method>GET</method>
        <method>OPTIONS</method>
      </allowed-methods>
      <allowed-headers>
        <header>*</header>
      </allowed-headers>
    </cors>
  </inbound>
  <backend>
    <forward-request />
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

output nativeAuthApiName string = nativeAuthApi.name
