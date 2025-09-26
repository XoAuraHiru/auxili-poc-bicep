az group create -n rg-auxili-poc-v2-dev -l "Southeast Asia"

az deployment group create -g rg-auxili-poc-v2-dev -f infrastructure/main.bicep -p @infrastructure/parameters/dev.parameters.json

# Re-run the deployment command above whenever new APIM operations (e.g. `/auth/password`) are added in Bicep so the gateway picks up the changes.

cd "user-function-app-v4";
func azure functionapp publish func-auxili-user-dev-ad7stftg;

cd "product-function-app-v4";
func azure functionapp publish func-auxili-product-dev-ad7stftg;

az functionapp config appsettings set `
  --name func-auxili-user-dev-ad7stftg `
  --resource-group rg-auxili-poc-v2-dev `
  --settings NATIVE_AUTH_ENABLED=true `
             NATIVE_AUTH_CLIENT_ID=c54e3f69-ee17-44c4-b044-018f629a6bf5 `
             NATIVE_AUTH_TENANT_SUBDOMAIN=auxilian `
             NATIVE_AUTH_SCOPES="openid profile email offline_access"



bicep build "infrastructure/native-auth/main.bicep"

New-AzResourceGroupDeployment `
  -ResourceGroupName <rg-name> `
  -TemplateFile "infrastructure/native-auth/main.bicep" `
  -TemplateParameterFile "infrastructure/native-auth/parameters/dev.parameters.json"


az group create -n hirun-auxili-poc -l "Southeast Asia"

az deployment group create `
  -g hirun-auxili-poc-v2 `
  -f infrastructure/native-auth/main.bicep `
  -p @infrastructure/native-auth/parameters/dev.parameters.json


cd "native-auth-function-app";
func azure functionapp publish func-auxili-nat-dev-oy7oll;

az functionapp config appsettings set `
  --name func-auxili-nat-dev-oy7oll `
  --resource-group hirun-auxili-poc `
  --settings `
    NATIVE_AUTH_CLIENT_ID=61b8e52d-f8f2-4564-a6b3-6cbd84af4c1c `
    NATIVE_AUTH_TENANT_SUBDOMAIN=auxiliumdev `
    NATIVE_AUTH_SCOPES="openid profile email offline_access"