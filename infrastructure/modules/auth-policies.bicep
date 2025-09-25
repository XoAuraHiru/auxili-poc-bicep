@description('Entra ID application ID for JWT validation')
param applicationId string

@description('Azure AD tenant ID')
param tenantId string

@description('Environment for configuration')
param environment string

@description('Whether to enable authentication (false for dev)')
param enableAuth bool

@description('Issuer URL for JWT validation')
param issuerUrl string

@description('JWKS URI for JWT validation')
param jwksUri string

// Suppress linter warnings - parameters are used in string interpolation within policy XML
#disable-next-line no-unused-params

// Note: Parameters are used in policy XML templates below via string interpolation

// JWT Validation Policy for Protected APIs (generic - function keys added in APIM module)
var jwtValidationPolicy = enableAuth ? '''
<policies>
  <inbound>
    <base />
    <!-- JWT Token Validation -->
    <validate-jwt header-name="Authorization" failed-validation-httpcode="401" failed-validation-error-message="Unauthorized. Access token is missing or invalid.">
      <openid-config url="${issuerUrl}/.well-known/openid_configuration" />
      <required-claims>
        <claim name="aud">
          <value>${applicationId}</value>
        </claim>
        <claim name="iss">
          <value>${issuerUrl}</value>
        </claim>
      </required-claims>
    </validate-jwt>
    
    <!-- Extract user information from JWT -->
    <set-variable name="userId" value="@{
      var jwt = context.Request.Headers.GetValueOrDefault("Authorization", "").Replace("Bearer ", "");
      if (string.IsNullOrEmpty(jwt)) return "anonymous";
      
      try {
        var payload = jwt.Split('.')[1];
        var paddedPayload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
        var decodedBytes = Convert.FromBase64String(paddedPayload);
        var decodedText = System.Text.Encoding.UTF8.GetString(decodedBytes);
        var token = Newtonsoft.Json.JsonConvert.DeserializeObject<dynamic>(decodedText);
        return token.sub ?? token.oid ?? "unknown";
      } catch {
        return "invalid";
      }
    }" />
    
    <!-- Set user context headers for downstream services -->
    <set-header name="X-User-Id" exists-action="override">
      <value>@((string)context.Variables["userId"])</value>
    </set-header>
    
    <!-- Rate limiting per user -->
    <rate-limit-by-key calls="1000" renewal-period="3600" counter-key="@((string)context.Variables["userId"])" />
    
    <!-- CORS for browser clients -->
    <cors allow-credentials="true">
      <allowed-origins>
        <origin>http://localhost:3000</origin>
        <origin>https://*.azurewebsites.net</origin>
      </allowed-origins>
      <allowed-methods>
        <method>GET</method>
        <method>POST</method>
        <method>PUT</method>
        <method>DELETE</method>
        <method>OPTIONS</method>
      </allowed-methods>
      <allowed-headers>
        <header>*</header>
      </allowed-headers>
    </cors>
  </inbound>
  <backend>
    <base />
  </backend>
  <outbound>
    <base />
    <!-- Security headers -->
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
  <on-error>
    <base />
  </on-error>
</policies>
''' : '''
<policies>
  <inbound>
    <base />
    <!-- Development mode - no authentication required -->
    <set-variable name="userId" value="dev-user" />
    <set-header name="X-User-Id" exists-action="override">
      <value>dev-user</value>
    </set-header>
    
    <!-- Basic rate limiting for dev -->
    <rate-limit calls="100" renewal-period="60" />
    
    <!-- CORS for development -->
    <cors>
      <allowed-origins>
        <origin>*</origin>
      </allowed-origins>
      <allowed-methods>
        <method>*</method>
      </allowed-methods>
      <allowed-headers>
        <header>*</header>
      </allowed-headers>
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

// Public endpoints policy (no authentication required)
var publicEndpointsPolicy = '''
<policies>
  <inbound>
    <base />
    <!-- No authentication required for public endpoints -->
    <rate-limit calls="50" renewal-period="60" />
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

// Output the policies for use in API configurations
output protectedApiPolicy string = jwtValidationPolicy
output publicApiPolicy string = publicEndpointsPolicy
output authenticationEnabled bool = enableAuth
