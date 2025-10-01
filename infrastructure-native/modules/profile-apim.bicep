@description('Azure API Management service name')
param apimName string

@description('Function App hostname hosting the profile endpoints')
param profileFunctionAppHostName string

@description('Function App name used to retrieve host keys')
param profileFunctionAppName string

@description('Display name for the Profile API inside API Management')
param apiDisplayName string = 'Profile API'

@description('Policy XML applied to protected profile endpoints (JWT enforced)')
param protectedApiPolicy string

@description('Policy XML applied to public profile endpoints (e.g., health checks)')
param publicApiPolicy string

resource apiManagement 'Microsoft.ApiManagement/service@2023-05-01-preview' existing = {
  name: apimName
}

resource profileFunctionApp 'Microsoft.Web/sites@2022-09-01' existing = {
  name: profileFunctionAppName
}

resource profileApi 'Microsoft.ApiManagement/service/apis@2023-05-01-preview' = {
  name: 'profile-api'
  parent: apiManagement
  properties: {
    displayName: apiDisplayName
    description: 'Authenticated profile management endpoints backed by Azure Functions.'
    serviceUrl: 'https://${profileFunctionAppHostName}/api/profile'
    path: 'profile'
    protocols: [
      'https'
    ]
    subscriptionRequired: false
    isCurrent: true
  }
}

resource getMyProfileOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'profile-get-me'
  parent: profileApi
  properties: {
    displayName: 'Get My Profile'
    method: 'GET'
    urlTemplate: '/me'
    description: 'Returns the authenticated caller\'s profile.'
  }
}

resource updateMyProfileOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'profile-update-me'
  parent: profileApi
  properties: {
    displayName: 'Update My Profile'
    method: 'PUT'
    urlTemplate: '/me'
    description: 'Updates mutable profile fields for the authenticated caller.'
  }
}

resource deleteMyProfileOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'profile-delete-me'
  parent: profileApi
  properties: {
    displayName: 'Delete My Profile'
    method: 'DELETE'
    urlTemplate: '/me'
    description: 'Deletes the authenticated caller\'s profile record.'
  }
}

resource getUserSettingsOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'profile-get-settings'
  parent: profileApi
  properties: {
    displayName: 'Get Profile Settings'
    method: 'GET'
    urlTemplate: '/settings'
    description: 'Retrieves stored preference data for the authenticated caller.'
  }
}

resource profileHealthOperation 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = {
  name: 'profile-health'
  parent: profileApi
  properties: {
    displayName: 'Profile Health'
    method: 'GET'
    urlTemplate: '/health'
    description: 'Health probe for the profile function app.'
  }
}

var profileFunctionKey = listkeys('${profileFunctionApp.id}/host/default', '2022-09-01').functionKeys.default
var inboundPlaceholder = '  <inbound>\n    <base />'
var functionKeyInjectedInbound = format('  <inbound>\n    <base />\n    <!-- Function App Authentication -->\n    <set-header name="x-functions-key" exists-action="override">\n      <value>{0}</value>\n    </set-header>', profileFunctionKey)

resource profileApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: profileApi
  properties: {
    value: replace(protectedApiPolicy, inboundPlaceholder, functionKeyInjectedInbound)
  }
}

resource profileHealthPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2023-05-01-preview' = {
  name: 'policy'
  parent: profileHealthOperation
  properties: {
    value: publicApiPolicy
  }
}

output profileApiName string = profileApi.name
