az group create -n rg-auxili-poc-v2-dev -l "Southeast Asia"

az deployment group create -g rg-auxili-poc-v2-dev -f infrastructure/main.bicep -p @infrastructure/parameters/dev.parameters.json