#!/bin/bash

echo "Building bot..."

bun build index.ts --outdir ./build --target=bun

if [ $? -eq 0 ]; then
    echo "Successfully built bot..."
else
    echo "Failed to build bot..."
    exit $?
fi
