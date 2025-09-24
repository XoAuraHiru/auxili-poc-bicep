az group create -n rg-auxili-poc-dev -l "Southeast Asia"

az deployment group create -g rg-auxili-poc-dev -f infrastructure/main.bicep -p @infrastructure/parameters/dev.parameters.json