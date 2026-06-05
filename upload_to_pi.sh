#!/bin/bash

echo "Uploading bot to PI..."

cd ./docker

sudo scp ./sliminator3000-image.tar ./Compose.yaml pacodataco@192.168.86.249:/home/pacodataco/bots/sliminator3000
