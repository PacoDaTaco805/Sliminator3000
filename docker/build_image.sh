#!/bin/bash

echo "Building Docker image..."

cd ../bot/
sudo docker build -t sliminator3000-image -f ../docker/Dockerfile .

if [ $? -eq 0 ]; then
    echo "Successfully built Docker image..."
else
    echo "Failed to build Docker image..."
    exit $?
fi
