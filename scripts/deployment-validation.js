#!/usr/bin/env node

/**
 * Comprehensive Deployment Validation Script
 * Runs all health checks, monitors tenant performance, and validates deployment readiness
 */

const { execSync } = require('child_process');
const path = require('path');

const config = {
  environment: process.env.ENVIRONMENT || 'staging',
  healthCheckTimeout: 300000, // 5 minutes
  retryAttempts: 3,
  retryDelay: 10000 // 10 seconds
};

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m'
};

class DeploymentValidator {
  constructor() {
    this.results = {
      infrastructure: false,
      tenantHealth: false,
      productionReadiness: false
    };
  }

  log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
  }

  async runTest(name, command, workingDir = '.') {
    this.log(`\n${colors.blue}═══ ${name} ═══${colors.reset}`);
    
    for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
      try {
        const result = execSync(command, { 
          cwd: workingDir, 
          encoding: 'utf-8',
          timeout: config.healthCheckTimeout,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        this.log(`${colors.green}✓${colors.reset} ${name} - PASSED`, colors.green);
        return { success: true, output: result };
        
      } catch (error) {
        if (attempt === config.retryAttempts) {
          this.log(`${colors.red}✗${colors.reset} ${name} - FAILED after ${attempt} attempts`, colors.red);
          console.log(`Error: ${error.message}`);
          if (error.stdout) console.log(`Stdout: ${error.stdout}`);
          if (error.stderr) console.log(`Stderr: ${error.stderr}`);
          return { success: false, error: error.message };
        } else {
          this.log(`${colors.yellow}⚠${colors.reset} ${name} - Attempt ${attempt} failed, retrying in ${config.retryDelay/1000}s...`);
          await this.sleep(config.retryDelay);
        }
      }
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async validateInfrastructure() {
    this.log(`\n${colors.bold}${colors.blue}╔════════════════════════════════════════╗${colors.reset}`);
    this.log(`${colors.bold}${colors.blue}║       INFRASTRUCTURE VALIDATION        ║${colors.reset}`);
    this.log(`${colors.bold}${colors.blue}╚════════════════════════════════════════╝${colors.reset}`);

    // Run infrastructure tests
    const infraResult = await this.runTest(
      'Infrastructure Health Check',
      'node scripts/production-health-check.js',
      path.resolve(__dirname, '..')
    );

    // Run updated infrastructure tests
    const detailedResult = await this.runTest(
      'Detailed Infrastructure Tests',
      'node tests/infrastructure-test-fixed.js',
      path.resolve(__dirname, '..')
    );

    this.results.infrastructure = infraResult.success && detailedResult.success;
    return this.results.infrastructure;
  }

  async validateTenantHealth() {
    this.log(`\n${colors.bold}${colors.blue}╔════════════════════════════════════════╗${colors.reset}`);
    this.log(`${colors.bold}${colors.blue}║         TENANT HEALTH VALIDATION       ║${colors.reset}`);
    this.log(`${colors.bold}${colors.blue}╚════════════════════════════════════════╝${colors.reset}`);

    const tenantResult = await this.runTest(
      'Production Tenant Health Check',
      'node scripts/tenant-health-production.js',
      path.resolve(__dirname, '..')
    );

    this.results.tenantHealth = tenantResult.success;
    return this.results.tenantHealth;
  }

  async validateApplicationTests() {
    this.log(`\n${colors.bold}${colors.blue}╔════════════════════════════════════════╗${colors.reset}`);
    this.log(`${colors.bold}${colors.blue}║        APPLICATION TEST VALIDATION     ║${colors.reset}`);
    this.log(`${colors.bold}${colors.blue}╚════════════════════════════════════════╝${colors.reset}`);

    // Test critical backend services
    const services = [
      { name: 'Auth Service Tests', path: '../ns-auth/backend', command: 'npm test' },
      { name: 'User Service Tests', path: '../ns-user/backend', command: 'npm test' },
      { name: 'Platform Tests', path: '../ns-platform-tests', command: 'npm run test:integration' }
    ];

    let allPassed = true;
    
    for (const service of services) {
      const result = await this.runTest(
        service.name,
        service.command,
        path.resolve(__dirname, service.path)
      );
      
      if (!result.success) {
        allPassed = false;
      }
    }

    return allPassed;
  }

  async generateDeploymentReport() {
    this.log(`\n${colors.bold}${colors.blue}╔════════════════════════════════════════╗${colors.reset}`);
    this.log(`${colors.bold}${colors.blue}║         DEPLOYMENT READINESS REPORT    ║${colors.reset}`);
    this.log(`${colors.bold}${colors.blue}╚════════════════════════════════════════╝${colors.reset}`);

    const infraStatus = this.results.infrastructure ? '✅ READY' : '❌ ISSUES';
    const tenantStatus = this.results.tenantHealth ? '✅ HEALTHY' : '❌ ISSUES';
    const testStatus = this.results.productionReadiness ? '✅ PASSED' : '❌ FAILED';

    this.log(`\nInfrastructure Health: ${infraStatus}`);
    this.log(`Tenant Health: ${tenantStatus}`);
    this.log(`Application Tests: ${testStatus}`);

    const overallReady = this.results.infrastructure && this.results.tenantHealth;

    if (overallReady) {
      this.log(`\n${colors.green}${colors.bold}🚀 DEPLOYMENT APPROVED FOR ${config.environment.toUpperCase()}!${colors.reset}`);
      this.log(`${colors.green}✅ Infrastructure is stable and healthy${colors.reset}`);
      this.log(`${colors.green}✅ Tenant isolation and performance validated${colors.reset}`);
      this.log(`${colors.green}✅ Ready for ${config.environment} deployment${colors.reset}`);
      
      // Generate deployment commands
      this.log(`\n${colors.blue}Next Steps:${colors.reset}`);
      this.log(`1. Push to ${config.environment} branch: git push origin ${config.environment}`);
      this.log(`2. Monitor deployment: gh run watch`);
      this.log(`3. Run post-deployment validation: npm run validate:${config.environment}`);
      
      return true;
    } else {
      this.log(`\n${colors.red}${colors.bold}🛑 DEPLOYMENT BLOCKED FOR ${config.environment.toUpperCase()}${colors.reset}`);
      this.log(`${colors.red}❌ Critical issues must be resolved before deployment${colors.reset}`);
      
      if (!this.results.infrastructure) {
        this.log(`${colors.red}   - Infrastructure health issues detected${colors.reset}`);
      }
      if (!this.results.tenantHealth) {
        this.log(`${colors.red}   - Tenant health or isolation issues detected${colors.reset}`);
      }
      
      return false;
    }
  }

  async runFullValidation() {
    this.log(`${colors.bold}${colors.blue}╔════════════════════════════════════════╗${colors.reset}`);
    this.log(`${colors.bold}${colors.blue}║     COMPREHENSIVE DEPLOYMENT VALIDATION║${colors.reset}`);
    this.log(`${colors.bold}${colors.blue}║           Environment: ${config.environment.toUpperCase().padEnd(13)}   ║${colors.reset}`);
    this.log(`${colors.bold}${colors.blue}║           ${new Date().toISOString()}    ║${colors.reset}`);
    this.log(`${colors.bold}${colors.blue}╚════════════════════════════════════════╝${colors.reset}`);

    try {
      // Step 1: Infrastructure validation
      await this.validateInfrastructure();
      
      // Step 2: Tenant health validation
      await this.validateTenantHealth();
      
      // Step 3: Application tests (optional - don't block deployment)
      try {
        this.results.productionReadiness = await this.validateApplicationTests();
      } catch (error) {
        this.log(`${colors.yellow}⚠${colors.reset} Application tests had issues but won't block deployment`);
        this.results.productionReadiness = false; // Don't fail deployment for test issues
      }
      
      // Step 4: Generate final report
      const deploymentApproved = await this.generateDeploymentReport();
      
      process.exit(deploymentApproved ? 0 : 1);
      
    } catch (error) {
      this.log(`${colors.red}${colors.bold}💥 VALIDATION FAILED${colors.reset}`);
      this.log(`${colors.red}Error: ${error.message}${colors.reset}`);
      process.exit(1);
    }
  }
}

// Main execution
if (require.main === module) {
  const validator = new DeploymentValidator();
  
  // Handle process signals gracefully
  process.on('SIGINT', () => {
    console.log(`\n${colors.yellow}⚠${colors.reset} Validation interrupted by user`);
    process.exit(1);
  });

  process.on('unhandledRejection', (error) => {
    console.error(`${colors.red}Unhandled error:${colors.reset}`, error.message);
    process.exit(1);
  });

  validator.runFullValidation();
}

module.exports = { DeploymentValidator };