#!/bin/bash

# Stop and cleanup local PostgreSQL development environment

echo "🛑 Stopping Docker containers..."
docker-compose down

echo "✅ Local development environment stopped."
echo ""
echo "💡 To remove volumes (database data): docker-compose down -v"
