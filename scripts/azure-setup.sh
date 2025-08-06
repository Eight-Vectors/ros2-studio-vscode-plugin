#!/bin/bash

# Azure Blob Storage Setup Script for VS Code ROS Extension GIFs
# Prerequisites: Azure CLI installed and logged in (az login)

# Configuration
RESOURCE_GROUP="vscode-ros-rg"
STORAGE_ACCOUNT="vscoderosgifs"  # Must be globally unique
LOCATION="eastus"
CONTAINER_NAME="gifs"

echo "🚀 Setting up Azure Blob Storage for GIFs..."

# Create resource group
echo "Creating resource group..."
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create storage account
echo "Creating storage account..."
az storage account create \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2 \
  --access-tier Hot

# Get storage account key
STORAGE_KEY=$(az storage account keys list \
  --resource-group $RESOURCE_GROUP \
  --account-name $STORAGE_ACCOUNT \
  --query '[0].value' \
  --output tsv)

# Create public container
echo "Creating public container..."
az storage container create \
  --name $CONTAINER_NAME \
  --account-name $STORAGE_ACCOUNT \
  --account-key $STORAGE_KEY \
  --public-access blob

# Upload GIFs (assuming they're in a local 'gifs' folder)
echo "Uploading GIFs..."
GIFS=(
  "connect-rosbridge.gif"
  "browse-entities.gif"
  "topic-visualization.gif"
  "node-parameters.gif"
  "bag-recorder.gif"
  "message-service-inspector.gif"
)

for gif in "${GIFS[@]}"; do
  if [ -f "gifs/$gif" ]; then
    echo "Uploading $gif..."
    az storage blob upload \
      --account-name $STORAGE_ACCOUNT \
      --account-key $STORAGE_KEY \
      --container-name $CONTAINER_NAME \
      --name $gif \
      --file "gifs/$gif"
  else
    echo "Warning: gifs/$gif not found"
  fi
done

# Display URLs
echo ""
echo "✅ Setup complete! Your GIF URLs:"
echo "================================"
for gif in "${GIFS[@]}"; do
  echo "https://$STORAGE_ACCOUNT.blob.core.windows.net/$CONTAINER_NAME/$gif"
done

# Set up cost alert (optional)
echo ""
echo "Setting up $10 cost alert..."
az consumption budget create \
  --budget-name "GIF-Storage-Budget" \
  --resource-group $RESOURCE_GROUP \
  --amount 10 \
  --time-grain Monthly \
  --category Cost \
  --time-period "{startDate:'$(date +%Y-%m-01)',endDate:'$(date -d '+1 year' +%Y-%m-01)'}"

echo ""
echo "🎉 All done! Update your README.md with the new URLs above."