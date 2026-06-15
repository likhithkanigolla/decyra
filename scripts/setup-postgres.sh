#!/bin/bash

# Setup script for local PostgreSQL development environment

set -e

echo "🚀 Setting up local PostgreSQL environment..."

# Check if docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker to continue."
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "⚠️  docker-compose not found. Trying 'docker compose'..."
    if ! command -v docker compose &> /dev/null; then
        echo "❌ docker-compose or 'docker compose' is not available."
        exit 1
    fi
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from .env.example..."
    cp .env.example .env
    echo "✅ .env created. Please update it with your configuration if needed."
fi

# Update .env to use local postgres by default
echo "🔧 Configuring .env for local PostgreSQL..."
if grep -q "DATABASE_TYPE=supabase" .env; then
    sed -i.bak 's/DATABASE_TYPE=supabase/DATABASE_TYPE=postgres/' .env
    rm -f .env.bak
fi

# Start Docker containers
echo "🐳 Starting Docker containers..."
$COMPOSE_CMD up -d

echo ""
echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 5

# Check if postgres is ready
for i in {1..30}; do
    if $COMPOSE_CMD exec -T postgres pg_isready -U postgres &> /dev/null; then
        echo "✅ PostgreSQL is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ PostgreSQL failed to start"
        exit 1
    fi
    echo "  Attempt $i/30..."
    sleep 1
done

echo ""
echo "✅ Local development environment is ready!"
echo ""
echo "📊 Database Access:"
echo "   URL: postgresql://postgres:postgres@localhost:5432/decyra"
echo "   Host: localhost"
echo "   Port: 5432"
echo "   Database: decyra"
echo "   User: postgres"
echo "   Password: postgres"
echo ""
echo "🔍 pgAdmin (Database UI):"
echo "   URL: http://localhost:5050"
echo "   Email: admin@admin.com"
echo "   Password: admin"
echo ""
echo "💡 To stop containers: $COMPOSE_CMD down"
echo "💡 To view logs: $COMPOSE_CMD logs -f postgres"
echo "💡 To rebuild containers: $COMPOSE_CMD up -d --build"
