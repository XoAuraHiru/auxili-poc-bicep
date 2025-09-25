az group create -n rg-auxili-poc-v2-dev -l "Southeast Asia"

az deployment group create -g rg-auxili-poc-v2-dev -f infrastructure/main.bicep -p @infrastructure/parameters/dev.parameters.json

# Re-run the deployment command above whenever new APIM operations (e.g. `/auth/password`) are added in Bicep so the gateway picks up the changes.

cd "user-function-app-v4";
func azure functionapp publish func-auxili-user-dev-ad7stftg;

cd "product-function-app-v4";
func azure functionapp publish func-auxili-product-dev-ad7stftg;
