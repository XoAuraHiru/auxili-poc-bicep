# Create Entra ID App Registration for API Authentication
# This script creates an app registration that will be used for JWT authentication in APIM

param(
    [Parameter(Mandatory=$true)]
    [string]$AppName,
    
    [Parameter(Mandatory=$true)]
    [string]$Environment,
    
    [string]$ReplyUrls = "http://localhost:3000,https://oauth.pstmn.io/v1/callback",
    
    [string]$HomepageUrl = ""
)

$appRegistrationName = "$AppName-$Environment"
$replyUrlArray = $ReplyUrls.Split(',')

Write-Host "Creating Entra ID App Registration: $appRegistrationName" -ForegroundColor Green

# Check if Azure PowerShell modules are installed
Write-Host "Checking Azure PowerShell modules..." -ForegroundColor Yellow

$requiredModules = @('Az.Accounts', 'Az.Resources')
$missingModules = @()

foreach ($module in $requiredModules) {
    if (!(Get-Module -ListAvailable -Name $module)) {
        $missingModules += $module
    }
}

if ($missingModules.Count -gt 0) {
    Write-Host "Missing required modules: $($missingModules -join ', ')" -ForegroundColor Red
    Write-Host "Installing missing modules..." -ForegroundColor Yellow
    
    foreach ($module in $missingModules) {
        try {
            Install-Module -Name $module -Force -AllowClobber -Scope CurrentUser
            Write-Host "Installed module: $module" -ForegroundColor Green
        } catch {
            Write-Host "Failed to install module $module`: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "Please run PowerShell as Administrator and install manually: Install-Module -Name $module" -ForegroundColor Yellow
            exit 1
        }
    }
}

# Import required modules
foreach ($module in $requiredModules) {
    Import-Module -Name $module -Force
}

# Check if already logged in to Azure
Write-Host "Checking Azure authentication..." -ForegroundColor Yellow
try {
    $context = Get-AzContext
    if (-not $context) {
        throw "Not logged in"
    }
    Write-Host "Using Azure context: $($context.Account.Id)" -ForegroundColor Green
} catch {
    Write-Host "Please login to Azure first using Connect-AzAccount" -ForegroundColor Red
    Write-Host "Running Connect-AzAccount now..." -ForegroundColor Yellow
    try {
        Connect-AzAccount
        $context = Get-AzContext
        Write-Host "Successfully logged in as: $($context.Account.Id)" -ForegroundColor Green
    } catch {
        Write-Host "Failed to login to Azure: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# Create the app registration
try {
    # Create App Registration
    $app = New-AzADApplication -DisplayName $appRegistrationName -ReplyUrls $replyUrlArray -HomePage $HomepageUrl
    
    Write-Host "App Registration created successfully!" -ForegroundColor Green
    Write-Host "Application ID: $($app.AppId)" -ForegroundColor Cyan
    Write-Host "Object ID: $($app.Id)" -ForegroundColor Cyan
    
    # Create Service Principal
    $sp = New-AzADServicePrincipal -ApplicationId $app.AppId
    Write-Host "Service Principal created: $($sp.Id)" -ForegroundColor Green
    
    # Get tenant information
    $tenant = Get-AzTenant | Select-Object -First 1
    
    Write-Host "`n=== Configuration Information ===" -ForegroundColor Yellow
    Write-Host "Application ID: $($app.AppId)"
    Write-Host "Tenant ID: $($tenant.Id)"
    Write-Host "Issuer URL: https://login.microsoftonline.com/$($tenant.Id)/v2.0"
    Write-Host "JWKS URI: https://login.microsoftonline.com/$($tenant.Id)/discovery/v2.0/keys"
    Write-Host "Authorization Endpoint: https://login.microsoftonline.com/$($tenant.Id)/oauth2/v2.0/authorize"
    Write-Host "Token Endpoint: https://login.microsoftonline.com/$($tenant.Id)/oauth2/v2.0/token"
    
    Write-Host "`n=== Next Steps ===" -ForegroundColor Yellow
    Write-Host "1. Update your Bicep parameters file with the Application ID: $($app.AppId)"
    Write-Host "2. Configure API permissions if needed in the Azure Portal"
    Write-Host "3. Deploy your infrastructure with authentication enabled"
    
    # Create a JSON output for easy parameter consumption
    $config = @{
        applicationId = $app.AppId
        tenantId = $tenant.Id
        issuerUrl = "https://login.microsoftonline.com/$($tenant.Id)/v2.0"
        jwksUri = "https://login.microsoftonline.com/$($tenant.Id)/discovery/v2.0/keys"
        authorizationEndpoint = "https://login.microsoftonline.com/$($tenant.Id)/oauth2/v2.0/authorize"
        tokenEndpoint = "https://login.microsoftonline.com/$($tenant.Id)/oauth2/v2.0/token"
    } | ConvertTo-Json -Depth 3
    
    $configFile = "auth-config-$Environment.json"
    $config | Out-File -FilePath $configFile -Encoding UTF8
    Write-Host "`nConfiguration saved to: $configFile" -ForegroundColor Green
    
} catch {
    Write-Host "Error creating app registration: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}