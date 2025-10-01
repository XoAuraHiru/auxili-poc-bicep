[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ResourceGroup,
    [Parameter()][string]$Environment = "dev",
    [Parameter()][string]$Location,
    [Parameter()][string]$ParametersFile,
    [Parameter()][string]$DeploymentName,
    [switch]$SkipInfrastructure,
    [switch]$SkipFunctions,
    [switch]$RunTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Ensure-Command {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$InstallHelp
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found. $InstallHelp"
    }
}

function Invoke-AzJson {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $result = az @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed: az $($Arguments -join ' ')"
    }

    if ([string]::IsNullOrWhiteSpace($result)) {
        return $null
    }

    return $result | ConvertFrom-Json
}

Write-Host "=== Auxili Native Auth Deployment ===" -ForegroundColor Cyan

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$infraDir = Split-Path -Parent $scriptRoot
$repoRoot = Split-Path -Parent $infraDir
$bicepFile = Join-Path $infraDir 'main.bicep'

if (-not (Test-Path $bicepFile)) {
    throw "Unable to locate main.bicep at '$bicepFile'."
}

if (-not $DeploymentName) {
    $DeploymentName = "native-$Environment"
}

if (-not $ParametersFile) {
    $defaultParameters = Join-Path (Join-Path $infraDir 'parameters') "$Environment.parameters.json"
    if (-not (Test-Path $defaultParameters)) {
        throw "Parameter file was not provided and the default '$defaultParameters' does not exist."
    }
    $ParametersFile = $defaultParameters
}

$ParametersFile = (Resolve-Path $ParametersFile).Path
Write-Host "Using parameters: $ParametersFile"

if (-not $SkipInfrastructure) {
    Ensure-Command -Name 'az' -InstallHelp 'Install the Azure CLI: https://learn.microsoft.com/cli/azure/install-azure-cli'

    try {
        Invoke-AzJson -Arguments @('account', 'show', '--only-show-errors', '--output', 'json') | Out-Null
    }
    catch {
        throw "Azure CLI is not logged in. Run 'az login' before executing this script."
    }

    if ($Location) {
        Write-Host "Ensuring resource group '$ResourceGroup' in '$Location'..."
        Invoke-AzJson -Arguments @('group', 'create', '-n', $ResourceGroup, '-l', $Location, '--only-show-errors', '--output', 'json') | Out-Null
    }
    else {
        $exists = az group exists -n $ResourceGroup
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to check if resource group '$ResourceGroup' exists."
        }
        if ($exists.Trim().ToLowerInvariant() -eq 'false') {
            throw "Resource group '$ResourceGroup' does not exist. Provide -Location to create it."
        }
    }

    Write-Host "Deploying infrastructure-native/main.bicep (deployment name: $DeploymentName)..."
    $deployment = Invoke-AzJson -Arguments @('deployment', 'group', 'create',
        '-g', $ResourceGroup,
        '-n', $DeploymentName,
        '-f', $bicepFile,
        '-p', "@$ParametersFile",
        '--only-show-errors',
        '--output', 'json')
}
else {
    Ensure-Command -Name 'az' -InstallHelp 'Install the Azure CLI: https://learn.microsoft.com/cli/azure/install-azure-cli'
    Write-Host "Skipping infrastructure deployment. Loading outputs from existing deployment '$DeploymentName'..."
    $deployment = Invoke-AzJson -Arguments @('deployment', 'group', 'show', '-g', $ResourceGroup, '-n', $DeploymentName, '--only-show-errors', '--output', 'json')
}

if (-not $deployment) {
    throw "Unable to retrieve deployment results."
}

$nativeOutput = $deployment.properties.outputs.functionAppName
$profileOutput = $deployment.properties.outputs.profileFunctionAppName
$apimOutput = $deployment.properties.outputs.apimName

$nativeFunctionName = if ($nativeOutput) { $nativeOutput.value } else { $null }
$profileFunctionName = if ($profileOutput) { $profileOutput.value } else { $null }
$apimName = if ($apimOutput) { $apimOutput.value } else { $null }

Write-Host "Deployment outputs:" -ForegroundColor Yellow
Write-Host "  Native auth function app: $nativeFunctionName"
Write-Host "  Profile function app:    $profileFunctionName"
Write-Host "  APIM instance:           $apimName"

if ($SkipFunctions) {
    Write-Host "Function publishing was skipped by request."
    return
}

Ensure-Command -Name 'func' -InstallHelp 'Install Azure Functions Core Tools (v4): https://aka.ms/azfunc-install'
Ensure-Command -Name 'npm' -InstallHelp 'Install Node.js (includes npm): https://nodejs.org/'

$functionApps = @()
if ($nativeFunctionName) {
    $functionApps += @{ Name = $nativeFunctionName; RelativePath = 'native-auth-function-app'; HasTests = $false }
}
else {
    Write-Warning "Native auth function app name was not present in deployment outputs."
}
if ($profileFunctionName) {
    $functionApps += @{ Name = $profileFunctionName; RelativePath = 'profile-function-app'; HasTests = $true }
}
else {
    Write-Warning "Profile function app name was not present in deployment outputs."
}

foreach ($app in $functionApps) {
    $appPath = Join-Path $repoRoot $app.RelativePath
    if (-not (Test-Path $appPath)) {
        Write-Warning "Project path not found for $($app.Name) at '$appPath'. Skipping."
        continue
    }

    Write-Host "\nPublishing $($app.Name) from '$appPath'..." -ForegroundColor Cyan
    Push-Location $appPath
    try {
        if (Test-Path 'package.json') {
            Write-Host "Installing npm dependencies..."
            npm install --no-audit --no-fund | Out-Host
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed for project '$($app.RelativePath)'."
            }
        }

        if ($RunTests -and $app.HasTests -and (Test-Path 'package.json')) {
            Write-Host "Running tests before publish..."
            npm run test | Out-Host
            if ($LASTEXITCODE -ne 0) {
                throw "Tests failed for project '$($app.RelativePath)'."
            }
        }

        Write-Host "Publishing via Azure Functions Core Tools..."
        func azure functionapp publish $app.Name --javascript --only-show-errors | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "Publishing failed for function app '$($app.Name)'."
        }
    }
    finally {
        Pop-Location
    }
}

Write-Host "\nDeployment complete." -ForegroundColor Green
