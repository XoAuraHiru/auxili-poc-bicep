az group create -n rg-auxili-poc-v2-dev -l "Southeast Asia"

az deployment group create -g rg-auxili-poc-v2-dev -f infrastructure/main.bicep -p @infrastructure/parameters/dev.parameters.json

cd "user-function-app-v4"; 
func azure functionapp publish func-auxili-user-dev-ad7stftg;

cd "product-function-app-v4"; 
func azure functionapp publish func-auxili-product-dev-ad7stftg;

