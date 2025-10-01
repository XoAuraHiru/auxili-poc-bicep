az group create -n hirun-auxili-poc-v2 -l "Southeast Asia"

az deployment group create -g hirun-auxili-poc-v2 -f infrastructure-native/main.bicep -p @infrastructure-native/parameters/dev.parameters.json

# Re-run the deployment command above whenever new APIM operations (e.g. `/auth/password` or `/profile/me`) are added in Bicep so the gateway picks up the changes.

cd "user-function-app-v4";
func azure functionapp publish func-auxili-user-dev-ad7stftg;

cd "product-function-app-v4";
func azure functionapp publish func-auxili-product-dev-ad7stftg;

cd "profile-function-app";
func azure functionapp publish func-auxili-profile-dev-<suffix>;

az functionapp config appsettings set `  --name func-auxili-user-dev-ad7stftg`
--resource-group rg-auxili-poc-v2-dev `  --settings NATIVE_AUTH_ENABLED=true`
NATIVE_AUTH_CLIENT_ID=c54e3f69-ee17-44c4-b044-018f629a6bf5 `             NATIVE_AUTH_TENANT_SUBDOMAIN=auxilian`
NATIVE_AUTH_SCOPES="openid profile email offline_access"

# Replace `<suffix>` with the unique segment emitted by the deployment outputs (for example `func-auxili-profile-dev-1b2c3d4e`).

bicep build "infrastructure-native/main.bicep"

New-AzResourceGroupDeployment `  -ResourceGroupName <rg-name>`
-TemplateFile "infrastructure-native/main.bicep" `
-TemplateParameterFile "infrastructure-native/parameters/dev.parameters.json"

az group create -n hirun-auxili-poc -l "Southeast Asia"

az deployment group create `  -g hirun-auxili-poc`
-f infrastructure-native/main.bicep `
-p @infrastructure-native/parameters/dev.parameters.json

cd "native-auth-function-app";
func azure functionapp publish func-auxili-nat-dev-oy7oll;

az functionapp config appsettings set `  --name func-auxili-nat-dev-peob54`
--resource-group hirun-auxili-poc-v2 `  --settings`
NATIVE_AUTH_CLIENT_ID=61b8e52d-f8f2-4564-a6b3-6cbd84af4c1c `    NATIVE_AUTH_TENANT_SUBDOMAIN=auxiliumdev`
NATIVE_AUTH_SCOPES="openid profile email offline_access"


az functionapp config appsettings set
     --name func-auxili-nat-dev-peob54
     --resource-group hirun-auxili-poc-v2
     --settings
       NATIVE_AUTH_ENABLED=true
       NATIVE_AUTH_CLIENT_ID=61b8e52d-f8f2-4564-a6b3-6cbd84af4c1c
       NATIVE_AUTH_TENANT_SUBDOMAIN=auxiliumdev
       NATIVE_AUTH_SCOPES="openid profile email offline_access"