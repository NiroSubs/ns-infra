# Configurable Authentication System

The VisualForge authentication system now supports flexible configuration where you can enable username/password authentication, Google OAuth, or both, per environment.

## Quick Start

### Configuration Commands

```bash
# Show current configuration
node scripts/configure-auth.js show dev

# Enable both authentication methods
node scripts/configure-auth.js enable-both dev --google-client-id=your-client-id

# Enable only username/password
node scripts/configure-auth.js enable-password-only local

# Enable only Google OAuth
node scripts/configure-auth.js enable-google-only production --google-client-id=prod-client-id
```

### Deploy Authentication Infrastructure

```bash
# Deploy with both methods (default)
./scripts/deploy-auth.sh dev --google-client-id=abc123 --google-client-secret=secret456

# Deploy with only username/password
./scripts/deploy-auth.sh dev --username-password=true --google-oauth=false

# Deploy with only Google OAuth
./scripts/deploy-auth.sh staging --username-password=false --google-oauth=true --google-client-id=xyz789 --google-client-secret=secret123
```

## Environment Variables

### Authentication Method Control
- `VITE_ENABLE_USERNAME_PASSWORD=true/false` - Enable username/password authentication
- `VITE_ENABLE_GOOGLE_OAUTH=true/false` - Enable Google OAuth authentication  
- `VITE_GOOGLE_CLIENT_ID=<client-id>` - Google OAuth Client ID

### Cognito Configuration
- `VITE_COGNITO_USER_POOL_ID` - AWS Cognito User Pool ID
- `VITE_COGNITO_CLIENT_ID` - AWS Cognito Client ID
- `VITE_COGNITO_DOMAIN` - Cognito Hosted UI domain

## Per-Environment Defaults

### Local Development (`.env.local`)
```env
VITE_ENABLE_USERNAME_PASSWORD=true
VITE_ENABLE_GOOGLE_OAUTH=false
VITE_GOOGLE_CLIENT_ID=
```

### Development (`.env.dev`) 
```env
VITE_ENABLE_USERNAME_PASSWORD=true
VITE_ENABLE_GOOGLE_OAUTH=true
VITE_GOOGLE_CLIENT_ID=YourGoogleClientId
```

### Staging (`.env.staging`)
```env
VITE_ENABLE_USERNAME_PASSWORD=true
VITE_ENABLE_GOOGLE_OAUTH=true
VITE_GOOGLE_CLIENT_ID=YourGoogleClientId
```

### Production (`.env.production`)
```env
VITE_ENABLE_USERNAME_PASSWORD=true
VITE_ENABLE_GOOGLE_OAUTH=true
VITE_GOOGLE_CLIENT_ID=YourGoogleClientId
```

## Frontend Integration

The `ConfigurableAuth` component automatically detects and displays the appropriate authentication methods based on environment configuration:

```tsx
import ConfigurableAuth from './components/ConfigurableAuth';

function App() {
  return (
    <ConfigurableAuth
      onAuthSuccess={(token, user) => {
        // Handle successful authentication
      }}
      onAuthError={(error) => {
        // Handle authentication error
      }}
    />
  );
}
```

## Authentication Flow Behavior

### Both Methods Enabled
- Shows Google "Continue with Google" button
- Shows divider with "or"
- Shows username/password form with Sign In/Sign Up tabs

### Username/Password Only
- Shows only the username/password form
- No Google button or divider

### Google OAuth Only  
- Shows only the "Continue with Google" button
- No username/password form

### No Methods Enabled
- Shows error message asking to configure at least one method
- Displays configuration instructions

## Test Credentials

### Development Environment
When `VITE_ENABLE_USERNAME_PASSWORD=true` in dev environment:
- **Email**: `test-user-1@visualforge.ai`
- **Password**: `TestPassword123!`

## Google OAuth Setup

1. **Google Cloud Console**:
   - Create OAuth 2.0 Client ID
   - Add authorized redirect URIs:
     - `https://app-dev.visualforge.ai/callback` (dev)
     - `https://app-stg.visualforge.ai/callback` (staging)  
     - `https://app.visualforge.ai/callback` (production)
     - `http://localhost:5173/callback` (local)

2. **AWS Cognito**:
   - Deploy the authentication stack with Google parameters
   - The CloudFormation template automatically configures the identity provider

## Troubleshooting

### "USER_PASSWORD_AUTH flow not enabled for this client"
- Ensure `EnableUsernamePassword=true` in CloudFormation parameters
- Redeploy the authentication stack: `./scripts/deploy-auth.sh <env> --username-password=true`

### Google OAuth not working
- Verify `VITE_ENABLE_GOOGLE_OAUTH=true` in environment file
- Ensure Google Client ID is set in both environment variables and CloudFormation
- Check that redirect URIs match exactly in Google Cloud Console

### No authentication methods available
- At least one method must be enabled
- Run: `node scripts/configure-auth.js enable-both <env> --google-client-id=<your-id>`

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │   AWS Cognito    │    │  Google OAuth   │
│                 │    │                  │    │                 │
│ ConfigurableAuth│ -> │  User Pool       │ -> │  Identity       │
│ Component       │    │  + Client        │    │  Provider       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │
         │                        │
         v                        v
┌─────────────────┐    ┌──────────────────┐
│ Environment     │    │ CloudFormation   │
│ Variables       │    │ Template         │
│ (.env files)    │    │ (configurable)   │
└─────────────────┘    └──────────────────┘
```

The system is designed to be completely flexible - you can enable/disable authentication methods per environment without code changes, just configuration updates.