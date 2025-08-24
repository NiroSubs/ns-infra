# Deploy all NS services to vf-dev
$env = "dev"
$region = "us-east-1"

Write-Host "Deploying NS services to vf-dev..." -ForegroundColor Cyan

# Deploy database first
Write-Host "  Deploying database..." -ForegroundColor Gray
aws cloudformation deploy `
    --template-file cloudformation/templates/database.yaml `
    --stack-name $env-ns-database `
    --parameter-overrides Environment=$env `
    --region $region `
    --capabilities CAPABILITY_IAM

# Deploy Cognito
Write-Host "  Deploying authentication..." -ForegroundColor Gray
aws cloudformation deploy `
    --template-file cloudformation/templates/cognito-real.yaml `
    --stack-name $env-ns-auth `
    --parameter-overrides Environment=$env `
    --region $region `
    --capabilities CAPABILITY_IAM

# Deploy API Gateway
Write-Host "  Deploying API Gateway..." -ForegroundColor Gray
aws cloudformation deploy `
    --template-file cloudformation/templates/api-gateway.yaml `
    --stack-name $env-ns-api `
    --parameter-overrides Environment=$env `
    --region $region `
    --capabilities CAPABILITY_NAMED_IAM

# Deploy Lambda functions
Write-Host "  Deploying Lambda functions..." -ForegroundColor Gray
cd lambda
npm install
npm run build
npm run deploy:dev

Write-Host "[OK] Deployment complete!" -ForegroundColor Green
