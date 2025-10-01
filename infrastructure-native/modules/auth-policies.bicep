@description('Entra ID application ID for JWT validation')
param applicationId string

@description('Azure AD tenant ID')
param tenantId string

@description('Environment for configuration')
param environment string

@description('Whether to enable authentication (false for dev)')
param enableAuth bool

@description('Issuer URL for JWT validation')
param issuerUrl string = '${az.environment().authentication.loginEndpoint}${tenantId}/v2.0'

@description('JWKS URI for JWT validation')
param jwksUri string = '${az.environment().authentication.loginEndpoint}${tenantId}/discovery/v2.0/keys'

@description('Additional audiences to accept when validating tokens')
param additionalAudiences array = []

@description('Scopes that must be present on delegated tokens')
param requiredScopes array = []

@description('App roles that must be present on application tokens')
param requiredRoles array = []

@description('Origins allowed for cross-origin requests')
param allowedOrigins array = environment == 'dev' ? [
  'http://localhost:3000'
  'https://oauth.pstmn.io'
] : [
  'https://oauth.pstmn.io'
]

@description('Maximum calls allowed per renewal period for authenticated traffic')
param rateLimitCalls int = 120

@description('Renewal period in seconds for the rate limit policy')
param rateLimitRenewalSeconds int = 60

var openIdConfigurationUrl = '${issuerUrl}/.well-known/openid-configuration'
var acceptedAudiences = concat([applicationId], additionalAudiences)

var audienceElements = [for audience in acceptedAudiences: '        <audience>${audience}</audience>']
var audiencesXml = '      <audiences>\n${join(audienceElements, '\n')}\n      </audiences>\n'

var scopeValueElements = [for scope in requiredScopes: '        <value>${scope}</value>']
var scopeClaimsXml = length(requiredScopes) > 0 ? '      <claim name="scp">\n${join(scopeValueElements, '\n')}\n      </claim>\n      <claim name="scope">\n${join(scopeValueElements, '\n')}\n      </claim>\n' : ''

var roleValueElements = [for role in requiredRoles: '        <value>${role}</value>']
var roleClaimsXml = length(requiredRoles) > 0 ? '      <claim name="roles">\n${join(roleValueElements, '\n')}\n      </claim>\n' : ''

var requiredClaimsXml = (length(requiredScopes) > 0 || length(requiredRoles) > 0) ? '      <required-claims>\n${scopeClaimsXml}${length(requiredScopes) > 0 && length(requiredRoles) > 0 ? '\n' : ''}${roleClaimsXml}      </required-claims>\n' : ''

var corsOriginElementsGenerated = [for origin in allowedOrigins: '        <origin>${origin}</origin>']
var corsOriginElements = length(corsOriginElementsGenerated) > 0 ? corsOriginElementsGenerated : ['        <origin>*</origin>']
var corsOriginsXml = join(corsOriginElements, '\n')

var jwksTrackingVariable = empty(jwksUri) ? '' : '    <set-variable name="jwksUri" value="${jwksUri}" />\n'

var protectedPolicyLines = [
  '<policies>'
  '  <inbound>'
  '    <base />'
  '    <validate-jwt header-name="Authorization" failed-validation-httpcode="401" failed-validation-error-message="Unauthorized. Access token is missing or invalid." output-token-variable-name="jwtToken">'
  '      <openid-config url="${openIdConfigurationUrl}" />'
  '${audiencesXml}      <issuers>'
  '        <issuer>${issuerUrl}</issuer>'
  '      </issuers>'
  '${requiredClaimsXml}    </validate-jwt>'
  '${jwksTrackingVariable}    <set-header name="X-User-Object-Id" exists-action="override">'
  '      <value>@(context.Variables.ContainsKey("jwtToken") ? ((((Jwt)context.Variables["jwtToken"]).Claims.GetValueOrDefault("oid")?.ToString()) ?? string.Empty) : string.Empty)</value>'
  '    </set-header>'
  '    <set-header name="X-User-Principal-Name" exists-action="override">'
  '      <value>@(context.Variables.ContainsKey("jwtToken") ? ((((Jwt)context.Variables["jwtToken"]).Claims.GetValueOrDefault("preferred_username")?.ToString()) ?? ((Jwt)context.Variables["jwtToken"]).Claims.GetValueOrDefault("email")?.ToString() ?? string.Empty) : string.Empty)</value>'
  '    </set-header>'
  '    <set-header name="X-User-Scopes" exists-action="override">'
  '      <value>@(context.Variables.ContainsKey("jwtToken") ? ((((Jwt)context.Variables["jwtToken"]).Claims.GetValueOrDefault("scp")?.ToString()) ?? ((Jwt)context.Variables["jwtToken"]).Claims.GetValueOrDefault("scope")?.ToString() ?? string.Empty) : string.Empty)</value>'
  '    </set-header>'
  '    <set-header name="X-Correlation-Id" exists-action="override">'
  '      <value>@(context.Request.Headers.GetValueOrDefault("x-correlation-id") ?? System.Guid.NewGuid().ToString())</value>'
  '    </set-header>'
  '    <set-header name="X-Environment" exists-action="override">'
  '      <value>${environment}</value>'
  '    </set-header>'
  '    <rate-limit calls="${rateLimitCalls}" renewal-period="${rateLimitRenewalSeconds}" />'
  '    <cors allow-credentials="true">'
  '      <allowed-origins>'
  '${corsOriginsXml}'
  '      </allowed-origins>'
  '      <allowed-methods>'
  '        <method>GET</method>'
  '        <method>POST</method>'
  '        <method>PUT</method>'
  '        <method>DELETE</method>'
  '        <method>OPTIONS</method>'
  '      </allowed-methods>'
  '      <allowed-headers>'
  '        <header>*</header>'
  '      </allowed-headers>'
  '      <expose-headers>'
  '        <header>X-Correlation-Id</header>'
  '      </expose-headers>'
  '    </cors>'
  '  </inbound>'
  '  <backend>'
  '    <base />'
  '  </backend>'
  '  <outbound>'
  '    <base />'
  '    <set-header name="X-Content-Type-Options" exists-action="override">'
  '      <value>nosniff</value>'
  '    </set-header>'
  '    <set-header name="X-Frame-Options" exists-action="override">'
  '      <value>DENY</value>'
  '    </set-header>'
  '    <set-header name="Strict-Transport-Security" exists-action="override">'
  '      <value>max-age=31536000; includeSubDomains</value>'
  '    </set-header>'
  '    <set-header name="Referrer-Policy" exists-action="override">'
  '      <value>no-referrer</value>'
  '    </set-header>'
  '  </outbound>'
  '  <on-error>'
  '    <base />'
  '  </on-error>'
  '</policies>'
]

var protectedPolicyRaw = join(protectedPolicyLines, '\n')

var publicPolicyRaw = '<policies>\n  <inbound>\n    <base />\n    <rate-limit calls="${rateLimitCalls}" renewal-period="${rateLimitRenewalSeconds}" />\n    <cors>\n      <allowed-origins>\n${corsOriginsXml}\n      </allowed-origins>\n      <allowed-methods>\n        <method>GET</method>\n        <method>POST</method>\n        <method>PUT</method>\n        <method>DELETE</method>\n        <method>OPTIONS</method>\n      </allowed-methods>\n      <allowed-headers>\n        <header>*</header>\n      </allowed-headers>\n    </cors>\n  </inbound>\n  <backend>\n    <base />\n  </backend>\n  <outbound>\n    <base />\n  </outbound>\n  <on-error>\n    <base />\n  </on-error>\n</policies>\n'

var developmentPolicyRaw = '<policies>\n  <inbound>\n    <base />\n    <set-variable name="userId" value="dev-user" />\n    <set-header name="X-User-Id" exists-action="override">\n      <value>dev-user</value>\n    </set-header>\n    <rate-limit calls="${rateLimitCalls}" renewal-period="${rateLimitRenewalSeconds}" />\n    <cors>\n      <allowed-origins>\n${corsOriginsXml}\n      </allowed-origins>\n      <allowed-methods>\n        <method>*</method>\n      </allowed-methods>\n      <allowed-headers>\n        <header>*</header>\n      </allowed-headers>\n    </cors>\n  </inbound>\n  <backend>\n    <base />\n  </backend>\n  <outbound>\n    <base />\n  </outbound>\n  <on-error>\n    <base />\n  </on-error>\n</policies>\n'

var protectedApiPolicy = enableAuth ? protectedPolicyRaw : developmentPolicyRaw
var publicApiPolicy = publicPolicyRaw

output protectedApiPolicy string = protectedApiPolicy
output publicApiPolicy string = publicApiPolicy
output authenticationEnabled bool = enableAuth
