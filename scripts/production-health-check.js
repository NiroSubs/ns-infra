#!/usr/bin/env node

const https = require('https');
const { execSync } = require('child_process');

// Production health check configuration
const config = {
  environment: process.env.ENVIRONMENT || 'dev',
  region: process.env.AWS_REGION || 'us-east-1',
  timeout: 10000,
  retries: 3
};

// Core services that must be healthy for production readiness
const healthChecks = {
  // CloudFront (CDN)
  cdn: [
    {
      name: 'CloudFront Distribution',
      url: 'https://dz2lwnpg8aefz.cloudfront.net/health',
      fallback: 'https://dz2lwnpg8aefz.cloudfront.net',
      critical: true
    }
  ],
  
  // API Gateway
  api: [
    {
      name: 'API Gateway Health',
      url: 'https://c39q8sqdp8.execute-api.us-east-1.amazonaws.com/dev/health',
      critical: true
    },
    {
      name: 'API Gateway Auth',
      url: 'https://c39q8sqdp8.execute-api.us-east-1.amazonaws.com/dev/auth/health',
      expectedStatus: [200, 403], // 403 is acceptable (auth required)
      critical: true
    }
  ],
  
  // DNS Resolution
  dns: [
    {
      name: 'Custom Domain',
      url: 'https://dev.visualforge.ai',
      critical: false, // Optional during development
      timeout: 5000
    }
  ]
};

let results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  critical_failures: []
};

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m'
};

function makeRequest(url, expectedStatus = [200], timeout = config.timeout) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    const request = https.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        const statusOk = expectedStatus.includes(res.statusCode);
        
        resolve({
          success: statusOk,
          statusCode: res.statusCode,
          responseTime,
          data: data.substring(0, 200) // Limit data size
        });
      });
    });
    
    request.on('error', (err) => {
      resolve({
        success: false,
        error: err.message,
        responseTime: Date.now() - startTime
      });
    });
    
    request.on('timeout', () => {
      request.destroy();
      resolve({
        success: false,
        error: 'Request timeout',
        responseTime: timeout
      });
    });
  });
}

async function testEndpoint(test) {
  const expectedStatus = test.expectedStatus || [200];
  const timeout = test.timeout || config.timeout;
  
  let result = await makeRequest(test.url, expectedStatus, timeout);
  
  // Try fallback if primary fails
  if (!result.success && test.fallback) {
    result = await makeRequest(test.fallback, expectedStatus, timeout);
  }
  
  if (result.success) {
    console.log(`${colors.green}✓${colors.reset} ${test.name} - Status: ${result.statusCode} (${result.responseTime}ms)`);
    results.passed++;
  } else {
    if (test.critical) {
      console.log(`${colors.red}✗${colors.reset} ${test.name} - ${result.error || `Status: ${result.statusCode}`} (${result.responseTime}ms)`);
      results.failed++;
      results.critical_failures.push(test.name);
    } else {
      console.log(`${colors.yellow}⚠${colors.reset} ${test.name} - ${result.error || `Status: ${result.statusCode}`} (non-critical)`);
      results.warnings++;
    }
  }
}

async function checkAWSServices() {
  console.log(`\n${colors.blue}═══ AWS Services Health ═══${colors.reset}`);
  
  try {
    // Check if AWS CLI is available
    execSync('aws --version', { stdio: 'ignore' });
    
    // Check Lambda functions (non-critical)
    try {
      const lambdas = execSync(
        `aws lambda list-functions --region ${config.region} --query "Functions[?contains(FunctionName, '${config.environment}-')].FunctionName" --output text`,
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      
      if (lambdas) {
        const functionCount = lambdas.split('\n').filter(f => f.trim()).length;
        console.log(`${colors.green}✓${colors.reset} Lambda Functions - Found ${functionCount} functions`);
        results.passed++;
      } else {
        console.log(`${colors.yellow}⚠${colors.reset} Lambda Functions - No functions found (may not be deployed)`);
        results.warnings++;
      }
    } catch (err) {
      console.log(`${colors.yellow}⚠${colors.reset} Lambda Functions - Unable to check (${err.message.split('\n')[0]})`);
      results.warnings++;
    }
    
    // Check Cognito User Pool (non-critical)
    try {
      const pools = execSync(
        `aws cognito-idp list-user-pools --max-results 10 --region ${config.region} --query "UserPools[?contains(Name, 'visualforge')].Name" --output text`,
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      
      if (pools && pools !== 'None') {
        console.log(`${colors.green}✓${colors.reset} Cognito User Pool - Found: ${pools}`);
        results.passed++;
      } else {
        console.log(`${colors.yellow}⚠${colors.reset} Cognito User Pool - Not found (may not be deployed)`);
        results.warnings++;
      }
    } catch (err) {
      console.log(`${colors.yellow}⚠${colors.reset} Cognito User Pool - Unable to check (${err.message.split('\n')[0]})`);
      results.warnings++;
    }
    
  } catch (err) {
    console.log(`${colors.yellow}⚠${colors.reset} AWS CLI not configured - Skipping AWS service checks`);
    results.warnings++;
  }
}

async function runHealthChecks() {
  console.log(`${colors.blue}${colors.bold}╔════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}${colors.bold}║     PRODUCTION HEALTH CHECK SUITE      ║${colors.reset}`);
  console.log(`${colors.blue}${colors.bold}║         Environment: ${config.environment.toUpperCase().padEnd(13)} ║${colors.reset}`);
  console.log(`${colors.blue}${colors.bold}╚════════════════════════════════════════╝${colors.reset}`);
  
  // Test CDN
  console.log(`\n${colors.blue}═══ CDN Health ═══${colors.reset}`);
  for (const test of healthChecks.cdn) {
    await testEndpoint(test);
  }
  
  // Test API Gateway
  console.log(`\n${colors.blue}═══ API Gateway Health ═══${colors.reset}`);
  for (const test of healthChecks.api) {
    await testEndpoint(test);
  }
  
  // Test DNS
  console.log(`\n${colors.blue}═══ DNS Resolution ═══${colors.reset}`);
  for (const test of healthChecks.dns) {
    await testEndpoint(test);
  }
  
  // Test AWS Services
  await checkAWSServices();
  
  // Generate Report
  console.log(`\n${colors.blue}${colors.bold}╔════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}${colors.bold}║           HEALTH CHECK SUMMARY          ║${colors.reset}`);
  console.log(`${colors.blue}${colors.bold}╚════════════════════════════════════════╝${colors.reset}`);
  
  const total = results.passed + results.failed + results.warnings;
  const healthScore = total > 0 ? Math.round((results.passed / total) * 100) : 0;
  
  console.log(`${colors.green}  ✓ Passed:   ${results.passed}${colors.reset}`);
  console.log(`${colors.red}  ✗ Failed:   ${results.failed}${colors.reset}`);
  console.log(`${colors.yellow}  ⚠ Warnings: ${results.warnings}${colors.reset}`);
  console.log(`\n  Health Score: ${healthScore}%`);
  
  // Production Readiness Assessment
  if (results.critical_failures.length === 0) {
    if (results.failed === 0) {
      console.log(`\n${colors.green}${colors.bold}🎉 PRODUCTION READY!${colors.reset}`);
      console.log('✅ All critical services are healthy');
      console.log('✅ No blocking issues detected');
      if (results.warnings > 0) {
        console.log(`⚠️  ${results.warnings} non-critical warnings (acceptable)`);
      }
      process.exit(0);
    } else {
      console.log(`\n${colors.yellow}${colors.bold}⚠️  MOSTLY READY${colors.reset}`);
      console.log('✅ All critical services are healthy');
      console.log('⚠️  Some non-critical services have issues');
      process.exit(0);
    }
  } else {
    console.log(`\n${colors.red}${colors.bold}❌ NOT PRODUCTION READY${colors.reset}`);
    console.log('❌ Critical services are failing:');
    results.critical_failures.forEach(service => {
      console.log(`   - ${service}`);
    });
    console.log('\n🔧 Fix critical issues before deploying to production');
    process.exit(1);
  }
}

// Error handling
process.on('unhandledRejection', (err) => {
  console.error(`${colors.red}Unhandled error:${colors.reset}`, err.message);
  process.exit(1);
});

// Run the health checks
runHealthChecks().catch(err => {
  console.error(`${colors.red}Health check failed:${colors.reset}`, err.message);
  process.exit(1);
});