#!/bin/bash

# Vext-RAG Deployment Script for Render
# This script helps prepare your application for deployment

echo "🚀 Vext-RAG Deployment Preparation Script"
echo "=========================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the project root."
    exit 1
fi

# Check if render.yaml exists
if [ ! -f "render.yaml" ]; then
    echo "❌ Error: render.yaml not found. Please ensure the deployment configuration exists."
    exit 1
fi

echo "✅ Found package.json and render.yaml"

# Check for required files
echo "📋 Checking required files..."
required_files=("src/index.js" "src/routes/api.js" "src/services/aiService.js" "src/services/vectorService.js")
missing_files=()

for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        missing_files+=("$file")
    fi
done

if [ ${#missing_files[@]} -ne 0 ]; then
    echo "❌ Missing required files:"
    for file in "${missing_files[@]}"; do
        echo "   - $file"
    done
    exit 1
fi

echo "✅ All required files found"

# Check for environment variables
echo "🔧 Checking environment configuration..."
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found"
    echo "   You'll need to set environment variables in Render dashboard:"
    echo "   - OPENAI_API_KEY"
    echo "   - MISTRAL_API_KEY"
else
    echo "✅ .env file found"
fi

# Check package.json scripts
echo "📦 Checking package.json configuration..."
if ! grep -q '"start"' package.json; then
    echo "❌ Error: 'start' script not found in package.json"
    exit 1
fi

echo "✅ Package.json configuration looks good"

# Create uploads directory if it doesn't exist
if [ ! -d "uploads" ]; then
    echo "📁 Creating uploads directory..."
    mkdir -p uploads
fi

# Create data directory if it doesn't exist
if [ ! -d "data" ]; then
    echo "📁 Creating data directory..."
    mkdir -p data
fi

echo ""
echo "🎉 Deployment preparation complete!"
echo ""
echo "Next steps:"
echo "1. Push your code to GitHub/GitLab"
echo "2. Go to render.com and create a new Blueprint"
echo "3. Connect your repository"
echo "4. Set your environment variables (OPENAI_API_KEY, MISTRAL_API_KEY)"
echo "5. Deploy!"
echo ""
echo "📖 For detailed instructions, see DEPLOYMENT.md" 