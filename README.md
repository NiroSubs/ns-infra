# NiroSubs Infrastructure

This repository contains all infrastructure-as-code for the NiroSubs platform, including CloudFormation templates, deployment workflows, and configuration management.

## Repository Structure

```
ns-infra/
├── cloudformation/
│   ├── templates/          # CloudFormation templates
│   │   ├── database.yaml
│   │   ├── cognito-real.yaml
│   │   ├── api-gateway-with-lambda.yaml
│   │   ├── lambda-execution-role.yaml
│   │   └── frontend-hosting.yaml
│   └── parameters/         # Environment-specific parameters
│       ├── dev.json
│       ├── staging.json
│       └── prod.json
├── .github/workflows/      # GitHub Actions workflows
│   ├── deploy-infrastructure.yml
│   └── deploy-services.yml
└── scripts/               # Deployment and utility scripts
```

## Deployment Architecture

### Infrastructure Components

1. **VPC & Networking** (`database.yaml`)
   - VPC with public/private subnets
   - NAT Gateway for Lambda internet access
   - Security groups for database and Lambda functions

2. **Database** (`database.yaml`)
   - Aurora Serverless v2 PostgreSQL cluster
   - Automated backups and encryption
   - Secrets Manager for connection details

3. **Authentication** (`cognito-real.yaml`)
   - Cognito User Pool and Client
   - OAuth configuration
   - Identity federation support

4. **Compute** (`lambda-execution-role.yaml`)
   - IAM roles and policies for Lambda functions
   - Cross-service permissions
   - VPC access permissions

5. **API Gateway** (`api-gateway-with-lambda.yaml`)
   - REST API with service-specific paths
   - Lambda integrations for each microservice
   - CORS configuration

6. **Frontend Hosting** (`frontend-hosting.yaml`)
   - S3 bucket for static assets
   - CloudFront distribution
   - Custom domain configuration

### Deployment Workflows

#### 1. Infrastructure Deployment (`deploy-infrastructure.yml`)

Deploys core infrastructure components:
- Triggered on changes to `cloudformation/**` files
- Branch-based environment mapping (main→prod, staging→staging, develop→dev)
- Can deploy specific stacks via workflow_dispatch

#### 2. Service Deployment (`deploy-services.yml`)

Deploys Lambda functions for microservices:
- Can be triggered by service repositories via repository_dispatch
- Builds and deploys individual services or all services
- Updates Lambda functions with latest code

## Environment Configuration

### Branch-Based Deployment Strategy

| Branch | Environment | Purpose |
|--------|-------------|---------|
| `master` | `prod` | Production environment |
| `staging` | `stg` | Staging environment for pre-production testing |
| `develop` | `dev` | Development environment |

### Required Secrets

Configure these secrets in your GitHub repository settings:

- `AWS_ACCESS_KEY_ID` - AWS access key with deployment permissions
- `AWS_SECRET_ACCESS_KEY` - AWS secret access key
- `AWS_ACCOUNT_ID` - Your AWS account ID
- `DB_MASTER_PASSWORD` - Master password for RDS instances
- `DB_SECRET_ARN` - ARN of the database secret in Secrets Manager
- `COGNITO_USER_POOL_ID` - Cognito User Pool ID
- `COGNITO_CLIENT_ID` - Cognito Client ID

## Usage

### Deploy Full Infrastructure

```bash
# Deploy to development
gh workflow run deploy-infrastructure.yml --ref develop

# Deploy to staging
gh workflow run deploy-infrastructure.yml --ref staging --input environment=staging

# Deploy to production
gh workflow run deploy-infrastructure.yml --ref main --input environment=prod
```

### Deploy Specific Stack

```bash
# Deploy only the database stack to dev
gh workflow run deploy-infrastructure.yml --ref develop --input environment=dev --input stack_name=database

# Deploy only API Gateway to production
gh workflow run deploy-infrastructure.yml --ref main --input environment=prod --input stack_name=api-gateway
```

### Deploy Services

```bash
# Deploy all services to dev
gh workflow run deploy-services.yml --input environment=dev --input service=all

# Deploy specific service to staging
gh workflow run deploy-services.yml --input environment=staging --input service=auth
```

### Trigger from Service Repositories

Service repositories can trigger deployments using repository_dispatch:

```yaml
- name: Trigger Infrastructure Deployment
  run: |
    curl -X POST \
      -H "Authorization: token ${{ secrets.GITHUB_TOKEN }}" \
      -H "Accept: application/vnd.github.v3+json" \
      https://api.github.com/repos/OWNER/ns-infra/dispatches \
      -d '{"event_type":"deploy-service","client_payload":{"environment":"dev","service":"auth"}}'
```

## Service Integration

Each service repository should include a workflow that:
1. Builds and tests the service
2. Triggers infrastructure deployment via repository_dispatch
3. Runs integration tests against deployed infrastructure

## Monitoring and Troubleshooting

### Stack Status

Check deployment status:
```bash
aws cloudformation describe-stacks --stack-name dev-nirosubs-database --region us-east-1
```

### Lambda Function Status

Check function deployment:
```bash
aws lambda get-function --function-name dev-ns-auth-lambda --region us-east-1
```

### API Gateway Testing

Test deployed endpoints:
```bash
curl -X GET "https://API_ID.execute-api.us-east-1.amazonaws.com/dev/ns-auth/health"
```

## Contributing

1. Make changes to CloudFormation templates in `cloudformation/templates/`
2. Test changes in development environment first
3. Use pull requests for changes to `main` and `staging` branches
4. Ensure all required parameters are documented

## Security

- All resources are deployed with least-privilege IAM policies
- Database is deployed in private subnets with no internet access
- Lambda functions use VPC endpoints for AWS service communication
- Secrets are stored in AWS Secrets Manager and rotated regularly