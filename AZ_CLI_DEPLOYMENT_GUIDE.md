# Azure CLI Deployment Cheat Sheet

This guide captures the end-to-end commands for deploying the Bicep infrastructure and publishing the Azure Function Apps using the Azure CLI from PowerShell on Windows.

---

## 1. Prerequisites

1. Install the latest [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli).
2. From a PowerShell prompt, sign in and select the correct subscription:

```powershell
az login
az account set --subscription "<subscription-id-or-name>"
```

3. (Optional) Confirm the active subscription:

```powershell
az account show --output table
```

---

## 2. Deploy the Bicep infrastructure

All commands below assume you are at the repository root (`auxili-poc-bicep`). Update the variable values to match the target environment.

```powershell
$resourceGroup = "rg-auxili-poc-v2-dev"
$templateFile  = "infrastructure-native/main.bicep"
$parameterFile = "infrastructure-native/parameters/dev.parameters.json"

# (Optional) Validate before deploying
az deployment group validate `
  --resource-group $resourceGroup `
  --template-file  $templateFile `
  --parameters     @$parameterFile

# Deploy the template
az deployment group create `
  --resource-group $resourceGroup `
  --template-file  $templateFile `
  --parameters     @$parameterFile
```

If you need to override or add individual parameters, append `name=value` pairs to the `az deployment group create` command:

```powershell
az deployment group create `
  --resource-group $resourceGroup `
  --template-file  $templateFile `
  --parameters     @$parameterFile `
                    keyVaultName=my-new-keyvault
```

---

## 3. Publish the Function Apps (config-zip)

The commands below package and deploy the two function apps (`native-auth` and `profile`) using `config-zip`. Each deployment uploads a zip that contains the app code plus production dependencies.

Set common variables:

```powershell
$resourceGroup = "rg-auxili-poc-v2-dev"
$nativeAppName = "<native-function-app-name>"      # e.g. func-auxili-nat-dev-xxxxxx
$profileAppName = "<profile-function-app-name>"    # e.g. func-auxili-nat-profile-dev-xxxxxx
```

### 3.1 Native Auth Function App

```powershell
# Ensure clean install of production dependencies
npm ci --omit=dev --prefix native-auth-function-app

# Create the deployment package
Compress-Archive `
  -Path "native-auth-function-app/*" `
  -DestinationPath "native-auth.zip" `
  -Force

# Deploy via config-zip
az functionapp deployment source config-zip `
  --resource-group $resourceGroup `
  --name           $nativeAppName `
  --src            native-auth.zip

# (Optional) remove the local zip once deployed
Remove-Item native-auth.zip
```

### 3.2 Profile Function App

```powershell
npm ci --omit=dev --prefix profile-function-app

Compress-Archive `
  -Path "profile-function-app/*" `
  -DestinationPath "profile.zip" `
  -Force

az functionapp deployment source config-zip `
  --resource-group $resourceGroup `
  --name           $profileAppName `
  --src            profile.zip

Remove-Item profile.zip
```

> **Tip:** If you prefer to skip the local cleanup, leave the `Remove-Item` commands out and the zip artifacts will remain for later reuse.

---

## 4. Post-deployment checks

1. Verify the function apps are running:

```powershell
az functionapp show --name $nativeAppName --resource-group $resourceGroup --query "state"
az functionapp show --name $profileAppName --resource-group $resourceGroup --query "state"
```

2. Tail app logs if troubleshooting:

```powershell
az webapp log tail --name $nativeAppName  --resource-group $resourceGroup
az webapp log tail --name $profileAppName --resource-group $resourceGroup
```

3. Confirm Key Vault secrets or other outputs from the Bicep deployment when needed:

```powershell
az deployment group show `
  --resource-group $resourceGroup `
  --name <deployment-name> `
  --query properties.outputs
```

You now have a repeatable CLI workflow to deploy infrastructure and publish the function apps whenever changes are ready.

az deployment group create -g rg-auxili-poc-v2-dev -n native-dev-cors -f infrastructure-native/main.bicep -p @infrastructure-native/parameters/dev.parameters.json                            

az deployment group create -g rg-auxili-poc-v2-dev -n native-dev-manual -f infrastructure-native/main.bicep -p @infrastructure-native/parameters/dev.parameters.json

cd "c:\Users\HIRUN\Documents\My Personal Projects\auxili-poc-bicep\native-auth-function-app"; func azure functionapp publish func-auxili-nat-dev-sbr5bb        

cd "c:\Users\HIRUN\Documents\My Personal Projects\auxili-poc-bicep\profile-function-app"; func azure functionapp publish func-auxili-nat-profile-dev-sbr5bb  