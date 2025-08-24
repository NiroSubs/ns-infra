# Deploy all NS services to ns-dev environment
$env = "dev"
$region = "us-east-1"

Write-Host "Deploying NiroSubs services to ns-dev..." -ForegroundColor Cyan

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

# Deploy Route53 DNS configuration
Write-Host "  Deploying DNS configuration..." -ForegroundColor Gray
aws cloudformation deploy `
    --template-file cloudformation/templates/route53-ns-dev.yaml `
    --stack-name $env-ns-route53 `
    --parameter-overrides Environment=$env `
    --region $region `
    --capabilities CAPABILITY_IAM

# Deploy Lambda functions
Write-Host "  Deploying Lambda functions..." -ForegroundColor Gray
cd lambda
npm install
npm run build
npm run deploy:dev

Write-Host "[OK] NiroSubs deployment complete!" -ForegroundColor Green
Write-Host "Services available at:" -ForegroundColor Yellow
Write-Host "  - Main: https://ns-dev.visualforge.ai" -ForegroundColor White
Write-Host "  - API: https://ns-api-dev.visualforge.ai" -ForegroundColor White
Write-Host "  - Auth: https://ns-auth-dev.visualforge.ai" -ForegroundColor White
Write-Host "  - Dashboard (includes NiroForge): https://ns-dashboard-dev.visualforge.ai" -ForegroundColor White