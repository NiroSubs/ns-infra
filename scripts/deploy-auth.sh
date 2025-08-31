#!/bin/bash
set -e

# Deploy Authentication Configuration Script
# Usage: ./deploy-auth.sh <environment> [options]
#
# Options:
#   --username-password=true/false (default: true)
#   --google-oauth=true/false (default: true)
#   --google-client-id=<client-id>
#   --google-client-secret=<client-secret>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default values
ENVIRONMENT="${1:-dev}"
ENABLE_USERNAME_PASSWORD="true"
ENABLE_GOOGLE_OAUTH="true"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
STACK_NAME="ns-${ENVIRONMENT}-auth"

# Parse command line arguments
for arg in "$@"; do
  case $arg in
    --username-password=*)
      ENABLE_USERNAME_PASSWORD="${arg#*=}"
      shift
      ;;
    --google-oauth=*)
      ENABLE_GOOGLE_OAUTH="${arg#*=}"
      shift
      ;;
    --google-client-id=*)
      GOOGLE_CLIENT_ID="${arg#*=}"
      shift
      ;;
    --google-client-secret=*)
      GOOGLE_CLIENT_SECRET="${arg#*=}"
      shift
      ;;
    --help)
      echo "Usage: $0 <environment> [options]"
      echo ""
      echo "Options:"
      echo "  --username-password=true/false    Enable username/password auth (default: true)"
      echo "  --google-oauth=true/false         Enable Google OAuth (default: true)"
      echo "  --google-client-id=<client-id>    Google OAuth Client ID"
      echo "  --google-client-secret=<secret>   Google OAuth Client Secret"
      echo ""
      echo "Examples:"
      echo "  # Deploy with both methods enabled (default)"
      echo "  $0 dev"
      echo ""
      echo "  # Deploy with only username/password"
      echo "  $0 dev --username-password=true --google-oauth=false"
      echo ""
      echo "  # Deploy with only Google OAuth"
      echo "  $0 dev --username-password=false --google-oauth=true --google-client-id=abc123 --google-client-secret=secret456"
      echo ""
      echo "  # Deploy production with both methods"
      echo "  $0 prod --google-client-id=prod-client-id --google-client-secret=prod-secret"
      exit 0
      ;;
  esac
done

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
  echo "Error: Environment must be one of: dev, staging, prod"
  exit 1
fi

# Validate at least one auth method is enabled
if [[ "$ENABLE_USERNAME_PASSWORD" != "true" && "$ENABLE_GOOGLE_OAUTH" != "true" ]]; then
  echo "Error: At least one authentication method must be enabled"
  exit 1
fi

# Validate Google OAuth parameters if enabled
if [[ "$ENABLE_GOOGLE_OAUTH" == "true" ]]; then
  if [[ -z "$GOOGLE_CLIENT_ID" || -z "$GOOGLE_CLIENT_SECRET" ]]; then
    echo "Error: Google OAuth is enabled but client ID or secret not provided"
    echo "Use --google-client-id and --google-client-secret options"
    exit 1
  fi
fi

# Display configuration
echo "🔐 Deploying Authentication Configuration"
echo "========================================"
echo "Environment: $ENVIRONMENT"
echo "Stack Name: $STACK_NAME"
echo "Username/Password Auth: $ENABLE_USERNAME_PASSWORD"
echo "Google OAuth: $ENABLE_GOOGLE_OAUTH"
if [[ "$ENABLE_GOOGLE_OAUTH" == "true" ]]; then
  echo "Google Client ID: ${GOOGLE_CLIENT_ID:0:8}..."
fi
echo ""

# Build CloudFormation parameters
PARAMETERS=(
  "ParameterKey=Environment,ParameterValue=$ENVIRONMENT"
  "ParameterKey=EnableUsernamePassword,ParameterValue=$ENABLE_USERNAME_PASSWORD"
  "ParameterKey=EnableGoogleOAuth,ParameterValue=$ENABLE_GOOGLE_OAUTH"
)

if [[ "$ENABLE_GOOGLE_OAUTH" == "true" ]]; then
  PARAMETERS+=(
    "ParameterKey=GoogleClientId,ParameterValue=$GOOGLE_CLIENT_ID"
    "ParameterKey=GoogleClientSecret,ParameterValue=$GOOGLE_CLIENT_SECRET"
  )
fi

# Deploy the stack
echo "📦 Deploying CloudFormation stack..."
aws cloudformation deploy \
  --template-file "$PROJECT_ROOT/cloudformation/templates/cognito-complete-auth.yaml" \
  --stack-name "$STACK_NAME" \
  --parameter-overrides "${PARAMETERS[@]}" \
  --capabilities CAPABILITY_IAM \
  --region us-east-1

# Get stack outputs
echo ""
echo "📋 Getting stack outputs..."
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table

# Update environment files
echo ""
echo "🔧 Updating frontend environment files..."

# Get actual values from CloudFormation outputs
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text)

CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ClientId`].OutputValue' \
  --output text)

COGNITO_DOMAIN=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolDomain`].OutputValue' \
  --output text)

# Update the appropriate environment file
ENV_FILE="$PROJECT_ROOT/../ns-dashboard/frontend/.env.$ENVIRONMENT"
if [[ "$ENVIRONMENT" == "prod" ]]; then
  ENV_FILE="$PROJECT_ROOT/../ns-dashboard/frontend/.env.production"
fi

# Update environment variables
if [[ -f "$ENV_FILE" ]]; then
  # Create backup
  cp "$ENV_FILE" "$ENV_FILE.backup"
  
  # Update Cognito configuration
  sed -i "s/VITE_COGNITO_USER_POOL_ID=.*/VITE_COGNITO_USER_POOL_ID=$USER_POOL_ID/" "$ENV_FILE"
  sed -i "s/VITE_COGNITO_CLIENT_ID=.*/VITE_COGNITO_CLIENT_ID=$CLIENT_ID/" "$ENV_FILE"
  sed -i "s|VITE_COGNITO_DOMAIN=.*|VITE_COGNITO_DOMAIN=${COGNITO_DOMAIN#https://}|" "$ENV_FILE"
  
  # Update authentication method configuration
  sed -i "s/VITE_ENABLE_USERNAME_PASSWORD=.*/VITE_ENABLE_USERNAME_PASSWORD=$ENABLE_USERNAME_PASSWORD/" "$ENV_FILE"
  sed -i "s/VITE_ENABLE_GOOGLE_OAUTH=.*/VITE_ENABLE_GOOGLE_OAUTH=$ENABLE_GOOGLE_OAUTH/" "$ENV_FILE"
  
  if [[ "$ENABLE_GOOGLE_OAUTH" == "true" ]]; then
    sed -i "s/VITE_GOOGLE_CLIENT_ID=.*/VITE_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID/" "$ENV_FILE"
  else
    sed -i "s/VITE_GOOGLE_CLIENT_ID=.*/VITE_GOOGLE_CLIENT_ID=/" "$ENV_FILE"
  fi
  
  echo "✅ Updated $ENV_FILE"
  echo "   - User Pool ID: $USER_POOL_ID"
  echo "   - Client ID: $CLIENT_ID"
  echo "   - Domain: ${COGNITO_DOMAIN#https://}"
  echo "   - Username/Password: $ENABLE_USERNAME_PASSWORD"
  echo "   - Google OAuth: $ENABLE_GOOGLE_OAUTH"
else
  echo "⚠️  Environment file not found: $ENV_FILE"
fi

echo ""
echo "🎉 Authentication deployment complete!"
echo ""
echo "📝 Next Steps:"
echo "1. Test the authentication in your frontend application"
echo "2. Update your GitHub Actions secrets if needed:"
echo "   - GOOGLE_CLIENT_ID_${ENVIRONMENT^^}: $GOOGLE_CLIENT_ID"
echo "   - GOOGLE_CLIENT_SECRET_${ENVIRONMENT^^}: [your-secret]"
echo "3. Deploy your frontend application with the updated configuration"

# Show test user info for dev environment
if [[ "$ENVIRONMENT" == "dev" && "$ENABLE_USERNAME_PASSWORD" == "true" ]]; then
  echo ""
  echo "🧪 Development Test User:"
  echo "   Email: test-user-1@visualforge.ai"
  echo "   Password: TestPassword123!"
fi