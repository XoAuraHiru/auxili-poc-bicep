# Create Entra ID App Registration using Azure CLI (PowerShell wrapper)
# This script uses Azure CLI commands to create an app registration

param(
    [Parameter(Mandatory=$true)]
    [string]$AppName,
    
    [Parameter(Mandatory=$true)]
    [string]$Environment,
    
    [string]$ReplyUrls = "http://localhost:3000,https://oauth.pstmn.io/v1/callback"
)

$ErrorActionPreference = "Stop"

$appRegistrationName = "$AppName-$Environment"

Write-Host "Creating Entra ID App Registration: $appRegistrationName" -ForegroundColor Green

# Check if Azure CLI is installed
try {
    $azVersion = az version 2>$null | ConvertFrom-Json
    Write-Host "Using Azure CLI version: $($azVersion.'azure-cli')" -ForegroundColor Yellow
} catch {
    Write-Host "Azure CLI is not installed or not working properly." -ForegroundColor Red
    Write-Host "Please install Azure CLI from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" -ForegroundColor Yellow
    exit 1
}

# Check if logged in to Azure
Write-Host "Checking Azure authentication..." -ForegroundColor Yellow
try {
    $accountInfo = az account show --query "{subscriptionId:id, tenantId:tenantId, user:user.name}" -o json | ConvertFrom-Json
    Write-Host "Logged in as: $($accountInfo.user)" -ForegroundColor Green
    Write-Host "Subscription: $($accountInfo.subscriptionId)" -ForegroundColor Green
    Write-Host "Tenant: $($accountInfo.tenantId)" -ForegroundColor Green
} catch {
    Write-Host "Not logged in to Azure. Please login first." -ForegroundColor Red
    Write-Host "Running 'az login'..." -ForegroundColor Yellow
    az login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to login to Azure" -ForegroundColor Red
        exit 1
    }
    # Get account info after login
    $accountInfo = az account show --query "{subscriptionId:id, tenantId:tenantId, user:user.name}" -o json | ConvertFrom-Json
}

$tenantId = $accountInfo.tenantId

# Convert reply URLs to JSON array
$replyUrlArray = $ReplyUrls -split ','
$replyUrlsJson = $replyUrlArray | ConvertTo-Json -Compress

Write-Host "Reply URLs: $replyUrlsJson" -ForegroundColor Yellow

# Check if app registration already exists
Write-Host "Checking if app registration already exists..." -ForegroundColor Yellow
$existingApp = az ad app list --display-name $appRegistrationName --query "[0].appId" -o tsv

if ($existingApp -and $existingApp -ne "null" -and $existingApp.Trim() -ne "") {
    Write-Host "App registration '$appRegistrationName' already exists with ID: $existingApp" -ForegroundColor Yellow
    $appId = $existingApp.Trim()
} else {
    # Create new app registration
    Write-Host "Creating new app registration..." -ForegroundColor Yellow
    
    # First create the basic app registration
    Write-Host "Creating basic app registration..." -ForegroundColor Gray
    $createResult = az ad app create --display-name $appRegistrationName --sign-in-audience "AzureADMyOrg" --query "{appId:appId, objectId:id}" -o json | ConvertFrom-Json
    
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create app registration"
    }
    
    $appId = $createResult.appId
    $objectId = $createResult.objectId
    
    Write-Host "Basic app registration created. Now updating with web configuration..." -ForegroundColor Gray
    
    # Update with web redirect URIs
    $webConfig = @{
        redirectUris = $replyUrlArray
    } | ConvertTo-Json -Compress
    
    az ad app update --id $appId --web-redirect-uris @($replyUrlArray)
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: Failed to update redirect URIs, but app registration was created" -ForegroundColor Yellow
    }
    
    try {
        
        $appId = $createResult.appId
        $objectId = $createResult.objectId
        
        Write-Host "App Registration created successfully!" -ForegroundColor Green
        Write-Host "Application ID: $appId" -ForegroundColor Cyan
        Write-Host "Object ID: $objectId" -ForegroundColor Cyan
        
        # Create Service Principal
        Write-Host "Creating service principal..." -ForegroundColor Yellow
        $spResult = az ad sp create --id $appId --query "id" -o tsv
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Service Principal created: $spResult" -ForegroundColor Green
        } else {
            Write-Host "Service Principal creation failed or already exists" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "Failed to create app registration: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# Generate configuration information
Write-Host "`n=== Configuration Information ===" -ForegroundColor Yellow
Write-Host "Application ID: $appId"
Write-Host "Tenant ID: $tenantId"
Write-Host "Issuer URL: https://login.microsoftonline.com/$tenantId/v2.0"
Write-Host "JWKS URI: https://login.microsoftonline.com/$tenantId/discovery/v2.0/keys"
Write-Host "Authorization Endpoint: https://login.microsoftonline.com/$tenantId/oauth2/v2.0/authorize"
Write-Host "Token Endpoint: https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token"

Write-Host "`n=== Next Steps ===" -ForegroundColor Yellow
Write-Host "1. Update your Bicep parameters file with the Application ID: $appId"
Write-Host "2. Configure API permissions if needed in the Azure Portal"
Write-Host "3. Deploy your infrastructure with authentication enabled"

# Create JSON configuration file
$config = @{
    applicationId = $appId
    tenantId = $tenantId
    issuerUrl = "https://login.microsoftonline.com/$tenantId/v2.0"
    jwksUri = "https://login.microsoftonline.com/$tenantId/discovery/v2.0/keys"
    authorizationEndpoint = "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/authorize"
    tokenEndpoint = "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token"
}

$configFile = "auth-config-$Environment.json"
$config | ConvertTo-Json -Depth 3 | Out-File -FilePath $configFile -Encoding UTF8
Write-Host "`nConfiguration saved to: $configFile" -ForegroundColor Green

# Update the parameters file if it exists
$paramFile = "../parameters/${Environment}.parameters.json"
if (Test-Path $paramFile) {
    Write-Host "Updating parameter file: $paramFile" -ForegroundColor Yellow
    
    # Create backup
    Copy-Item $paramFile "${paramFile}.backup"
    
    # Read and update the parameter file
    $paramContent = Get-Content $paramFile -Raw | ConvertFrom-Json
    $paramContent.parameters.entraAppId.value = $appId
    
    $paramContent | ConvertTo-Json -Depth 10 | Out-File -FilePath $paramFile -Encoding UTF8
    
    Write-Host "Parameter file updated with Application ID" -ForegroundColor Green
    Write-Host "Backup saved as: ${paramFile}.backup" -ForegroundColor Yellow
} else {
    Write-Host "Parameter file not found: $paramFile" -ForegroundColor Yellow
    Write-Host "Please manually update your parameter file with the Application ID: $appId" -ForegroundColor Yellow
}

Write-Host "`nEntra ID App Registration setup completed!" -ForegroundColor Green