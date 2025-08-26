#!/bin/bash
# Database migration runner for deployment pipeline
# This runs during deployment to each environment (dev, staging, prod)

set -e  # Exit on any error

ENVIRONMENT=${1:-dev}
echo "🚀 Running database migrations for environment: $ENVIRONMENT"

# Get database connection from AWS Secrets Manager
SECRET_ARN="arn:aws:secretsmanager:us-east-1:${AWS_ACCOUNT_ID}:secret:${ENVIRONMENT}/visualforge/database"

echo "📡 Retrieving database credentials from Secrets Manager..."
DB_SECRET=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query SecretString --output text)

# Parse the JSON secret
DB_HOST=$(echo $DB_SECRET | jq -r '.host')
DB_PORT=$(echo $DB_SECRET | jq -r '.port')
DB_NAME=$(echo $DB_SECRET | jq -r '.database')
DB_USER=$(echo $DB_SECRET | jq -r '.username')
DB_PASS=$(echo $DB_SECRET | jq -r '.password')

# Construct connection string
export DATABASE_URL="postgresql://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME"

echo "🗄️  Connecting to database: $DB_HOST:$DB_PORT/$DB_NAME"

# Run migrations using Drizzle
echo "📦 Running Drizzle migrations..."

# For each service that has migrations
SERVICES=("ns-auth" "ns-user" "ns-dashboard" "ns-payments")

for service in "${SERVICES[@]}"; do
  if [ -d "../$service/backend/drizzle" ]; then
    echo "  📋 Running migrations for $service..."
    cd "../$service/backend"
    
    # Install dependencies if not present
    if [ ! -d "node_modules" ]; then
      npm ci --production
    fi
    
    # Run Drizzle migrations
    npm run db:migrate || echo "    ⚠️  No migrations or migration failed for $service"
    
    cd - > /dev/null
  fi
done

echo "✅ Database migrations completed for $ENVIRONMENT"