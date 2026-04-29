#!/bin/bash
# Finance Hub — Quick Setup Script

echo ""
echo "⬡ FINANCE HUB SETUP"
echo "===================="

# Create data directory
mkdir -p data

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Install it from https://python3.org"
    exit 1
fi

echo "✅ Python 3 found: $(python3 --version)"

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate and install
source venv/bin/activate
echo "📦 Installing dependencies..."
pip install -q -r requirements.txt

echo ""
echo "✅ Setup complete!"
echo ""
echo "🚀 Starting Finance Hub on http://localhost:5000"
echo "   Press Ctrl+C to stop"
echo ""

python3 app.py
