#!/usr/bin/env node
/**
 * Authentication Configuration Helper
 * Easy script to configure authentication methods for any environment
 */

const fs = require('fs');
const path = require('path');

const ENVIRONMENTS = {
  local: { file: '.env.local', name: 'Local Development' },
  dev: { file: '.env.dev', name: 'Development' },
  staging: { file: '.env.staging', name: 'Staging' },
  production: { file: '.env.production', name: 'Production' }
};

function updateEnvFile(environment, config) {
  const envFile = path.join(__dirname, '../../ns-dashboard/frontend', ENVIRONMENTS[environment].file);
  
  if (!fs.existsSync(envFile)) {
    console.error(`❌ Environment file not found: ${envFile}`);
    return false;
  }

  // Read current file
  let content = fs.readFileSync(envFile, 'utf8');
  
  // Update authentication configuration
  content = content.replace(/VITE_ENABLE_USERNAME_PASSWORD=.*/, `VITE_ENABLE_USERNAME_PASSWORD=${config.enableUsernamePassword}`);
  content = content.replace(/VITE_ENABLE_GOOGLE_OAUTH=.*/, `VITE_ENABLE_GOOGLE_OAUTH=${config.enableGoogleOAuth}`);
  content = content.replace(/VITE_GOOGLE_CLIENT_ID=.*/, `VITE_GOOGLE_CLIENT_ID=${config.googleClientId || ''}`);

  // Write updated content
  fs.writeFileSync(envFile, content);
  
  console.log(`✅ Updated ${ENVIRONMENTS[environment].name} configuration:`);
  console.log(`   File: ${envFile}`);
  console.log(`   Username/Password: ${config.enableUsernamePassword}`);
  console.log(`   Google OAuth: ${config.enableGoogleOAuth}`);
  console.log(`   Google Client ID: ${config.googleClientId || 'Not set'}`);
  
  return true;
}

function showCurrentConfig(environment) {
  const envFile = path.join(__dirname, '../../ns-dashboard/frontend', ENVIRONMENTS[environment].file);
  
  if (!fs.existsSync(envFile)) {
    console.error(`❌ Environment file not found: ${envFile}`);
    return;
  }

  const content = fs.readFileSync(envFile, 'utf8');
  
  const usernamePassword = content.match(/VITE_ENABLE_USERNAME_PASSWORD=(.*)$/m)?.[1] || 'false';
  const googleOAuth = content.match(/VITE_ENABLE_GOOGLE_OAUTH=(.*)$/m)?.[1] || 'false';
  const googleClientId = content.match(/VITE_GOOGLE_CLIENT_ID=(.*)$/m)?.[1] || '';
  
  console.log(`🔐 Current ${ENVIRONMENTS[environment].name} Authentication Configuration:`);
  console.log(`   Username/Password: ${usernamePassword}`);
  console.log(`   Google OAuth: ${googleOAuth}`);
  console.log(`   Google Client ID: ${googleClientId || 'Not set'}`);
}

function showHelp() {
  console.log('Authentication Configuration Helper');
  console.log('==================================');
  console.log('');
  console.log('Usage: node configure-auth.js <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  show <env>                    Show current configuration');
  console.log('  enable-both <env>             Enable both auth methods');
  console.log('  enable-password-only <env>    Enable only username/password');
  console.log('  enable-google-only <env>      Enable only Google OAuth (requires client ID)');
  console.log('  disable-all <env>             Disable all auth methods (not recommended)');
  console.log('');
  console.log('Options:');
  console.log('  --google-client-id=<id>       Set Google OAuth Client ID');
  console.log('');
  console.log('Environments: local, dev, staging, production');
  console.log('');
  console.log('Examples:');
  console.log('  # Show current dev configuration');
  console.log('  node configure-auth.js show dev');
  console.log('');
  console.log('  # Enable both methods for dev');
  console.log('  node configure-auth.js enable-both dev --google-client-id=your-client-id');
  console.log('');
  console.log('  # Enable only username/password for local development');
  console.log('  node configure-auth.js enable-password-only local');
  console.log('');
  console.log('  # Enable only Google OAuth for production');
  console.log('  node configure-auth.js enable-google-only production --google-client-id=prod-client-id');
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    return;
  }

  const command = args[0];
  const environment = args[1];
  
  if (!environment || !ENVIRONMENTS[environment]) {
    console.error('❌ Invalid or missing environment. Must be one of: local, dev, staging, production');
    return;
  }

  // Parse options
  let googleClientId = '';
  for (const arg of args) {
    if (arg.startsWith('--google-client-id=')) {
      googleClientId = arg.split('=')[1];
    }
  }

  switch (command) {
    case 'show':
      showCurrentConfig(environment);
      break;
      
    case 'enable-both':
      updateEnvFile(environment, {
        enableUsernamePassword: 'true',
        enableGoogleOAuth: 'true',
        googleClientId
      });
      break;
      
    case 'enable-password-only':
      updateEnvFile(environment, {
        enableUsernamePassword: 'true',
        enableGoogleOAuth: 'false',
        googleClientId: ''
      });
      break;
      
    case 'enable-google-only':
      if (!googleClientId) {
        console.error('❌ Google Client ID is required for Google-only authentication');
        console.error('   Use: --google-client-id=your-client-id');
        return;
      }
      updateEnvFile(environment, {
        enableUsernamePassword: 'false',
        enableGoogleOAuth: 'true',
        googleClientId
      });
      break;
      
    case 'disable-all':
      console.warn('⚠️  Warning: Disabling all authentication methods is not recommended');
      updateEnvFile(environment, {
        enableUsernamePassword: 'false',
        enableGoogleOAuth: 'false',
        googleClientId: ''
      });
      break;
      
    default:
      console.error(`❌ Unknown command: ${command}`);
      showHelp();
  }
}

if (require.main === module) {
  main();
}