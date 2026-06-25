#!/bin/bash
# Start Talkomatic Server

cd "$(dirname "$0")"

echo "Installing dependencies..."
npm install

echo ""
echo "Starting Talkomatic Server..."
echo ""

npm start
