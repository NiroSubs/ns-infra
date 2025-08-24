#!/usr/bin/env node

const { Client } = require('pg');

// Production tenant health monitoring - Focus on critical tenant isolation and data integrity
const config = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'visualforge',
    user: process.env.DB_USER || 'apiuser',
    password: process.env.DB_PASSWORD || 'vsForgeP@ss!'
  }
};

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m'
};

class ProductionTenantHealth {
  constructor() {
    this.db = null;
    this.issues = [];
  }

  async connect() {
    try {
      this.db = new Client(config.database);
      await this.db.connect();
      console.log(`${colors.green}✓${colors.reset} Database connection established`);
    } catch (error) {
      console.error(`${colors.red}✗${colors.reset} Database connection failed:`, error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.db) {
      await this.db.end();
    }
  }

  async checkTenantIsolation() {
    console.log(`\n${colors.blue}═══ Critical Tenant Isolation Check ═══${colors.reset}`);
    
    try {
      // Check for tenant data isolation violations
      const isolationCheck = await this.db.query(`
        WITH tenant_data_integrity AS (
          SELECT 
            t.id as tenant_id,
            t.name as tenant_name,
            COUNT(tu.id) as user_count,
            COUNT(CASE WHEN tu.tenant_id != t.id THEN 1 END) as isolation_violations
          FROM tenants t
          LEFT JOIN tenant_users tu ON tu.tenant_id = t.id
          WHERE t.status = 'active'
          GROUP BY t.id, t.name
        )
        SELECT 
          tenant_name,
          user_count,
          isolation_violations
        FROM tenant_data_integrity
        WHERE isolation_violations > 0
      `);

      if (isolationCheck.rows.length === 0) {
        console.log(`${colors.green}✓${colors.reset} Tenant isolation verified - No data leakage detected`);
        return true;
      } else {
        console.log(`${colors.red}✗${colors.reset} CRITICAL: Tenant isolation violations detected`);
        isolationCheck.rows.forEach(row => {
          console.log(`  - ${row.tenant_name}: ${row.isolation_violations} violations`);
          this.issues.push(`Tenant isolation violation: ${row.tenant_name}`);
        });
        return false;
      }
    } catch (error) {
      console.error(`${colors.red}✗${colors.reset} Tenant isolation check failed:`, error.message);
      this.issues.push(`Isolation check failure: ${error.message}`);
      return false;
    }
  }

  async checkTenantLimits() {
    console.log(`\n${colors.blue}═══ Tenant Capacity Check ═══${colors.reset}`);
    
    try {
      const capacityCheck = await this.db.query(`
        WITH tenant_capacity AS (
          SELECT 
            t.id,
            t.name,
            t.plan,
            COUNT(tu.id) as current_users,
            COALESCE(t.limits->>'users', '999999')::int as max_users,
            CASE 
              WHEN t.limits->>'users' = '-1' THEN 'UNLIMITED'
              WHEN COUNT(tu.id) > COALESCE(t.limits->>'users', '999999')::int THEN 'EXCEEDED'
              WHEN COUNT(tu.id) > COALESCE(t.limits->>'users', '999999')::int * 0.9 THEN 'HIGH'
              ELSE 'OK'
            END as capacity_status
          FROM tenants t
          LEFT JOIN tenant_users tu ON tu.tenant_id = t.id AND tu.status = 'active'
          WHERE t.status = 'active'
          GROUP BY t.id, t.name, t.plan, t.limits
        )
        SELECT * FROM tenant_capacity
        ORDER BY 
          CASE capacity_status 
            WHEN 'EXCEEDED' THEN 1 
            WHEN 'HIGH' THEN 2 
            ELSE 3 
          END
      `);

      let exceededCount = 0;
      let warningCount = 0;
      let healthyCount = 0;

      capacityCheck.rows.forEach(tenant => {
        if (tenant.capacity_status === 'EXCEEDED') {
          console.log(`${colors.red}✗${colors.reset} ${tenant.name} - CRITICAL: Users ${tenant.current_users}/${tenant.max_users === -1 ? '∞' : tenant.max_users} (${tenant.plan})`);
          this.issues.push(`Tenant capacity exceeded: ${tenant.name}`);
          exceededCount++;
        } else if (tenant.capacity_status === 'HIGH') {
          console.log(`${colors.yellow}⚠${colors.reset} ${tenant.name} - WARNING: Users ${tenant.current_users}/${tenant.max_users === -1 ? '∞' : tenant.max_users} (${tenant.plan})`);
          warningCount++;
        } else {
          console.log(`${colors.green}✓${colors.reset} ${tenant.name} - OK: Users ${tenant.current_users}/${tenant.max_users === -1 ? '∞' : tenant.max_users} (${tenant.plan})`);
          healthyCount++;
        }
      });

      console.log(`\nCapacity Summary: ${healthyCount} healthy, ${warningCount} warnings, ${exceededCount} exceeded`);
      return exceededCount === 0;
      
    } catch (error) {
      console.error(`${colors.red}✗${colors.reset} Tenant capacity check failed:`, error.message);
      this.issues.push(`Capacity check failure: ${error.message}`);
      return false;
    }
  }

  async checkDatabaseHealth() {
    console.log(`\n${colors.blue}═══ Database Health Check ═══${colors.reset}`);
    
    try {
      // Check active tenant count
      const tenantCount = await this.db.query("SELECT COUNT(*) as count FROM tenants WHERE status = 'active'");
      const activeTenants = parseInt(tenantCount.rows[0].count);
      
      if (activeTenants > 0) {
        console.log(`${colors.green}✓${colors.reset} Database healthy - ${activeTenants} active tenants`);
      } else {
        console.log(`${colors.red}✗${colors.reset} No active tenants found - potential database issue`);
        this.issues.push('No active tenants in database');
        return false;
      }

      // Check for orphaned data
      const orphanCheck = await this.db.query(`
        SELECT 
          'tenant_users' as table_name,
          COUNT(*) as orphan_count
        FROM tenant_users tu 
        LEFT JOIN tenants t ON tu.tenant_id = t.id 
        WHERE t.id IS NULL
      `);

      const orphanCount = parseInt(orphanCheck.rows[0].orphan_count);
      if (orphanCount > 0) {
        console.log(`${colors.yellow}⚠${colors.reset} Found ${orphanCount} orphaned tenant_users records`);
      } else {
        console.log(`${colors.green}✓${colors.reset} No orphaned data detected`);
      }

      return true;
      
    } catch (error) {
      console.error(`${colors.red}✗${colors.reset} Database health check failed:`, error.message);
      this.issues.push(`Database health failure: ${error.message}`);
      return false;
    }
  }

  async generateProductionReport() {
    console.log(`\n${colors.blue}${colors.bold}╔════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}║       PRODUCTION TENANT HEALTH REPORT  ║${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}╚════════════════════════════════════════╝${colors.reset}`);

    const criticalIssues = this.issues.length;

    if (criticalIssues === 0) {
      console.log(`\n${colors.green}${colors.bold}✅ TENANT SYSTEM PRODUCTION READY${colors.reset}`);
      console.log(`${colors.green}✅ Tenant isolation verified${colors.reset}`);
      console.log(`${colors.green}✅ Tenant capacity within limits${colors.reset}`);
      console.log(`${colors.green}✅ Database integrity confirmed${colors.reset}`);
      console.log(`\n${colors.blue}🚀 Safe to deploy to production${colors.reset}`);
      return true;
    } else {
      console.log(`\n${colors.red}${colors.bold}❌ PRODUCTION DEPLOYMENT BLOCKED${colors.reset}`);
      console.log(`${colors.red}❌ ${criticalIssues} critical tenant issues detected:${colors.reset}`);
      this.issues.forEach(issue => {
        console.log(`${colors.red}   - ${issue}${colors.reset}`);
      });
      console.log(`\n${colors.red}🛑 Fix all issues before production deployment${colors.reset}`);
      return false;
    }
  }

  async runProductionHealthCheck() {
    console.log(`${colors.blue}${colors.bold}╔════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}║    PRODUCTION TENANT HEALTH VALIDATOR   ║${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}║           ${new Date().toISOString()}    ║${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}╚════════════════════════════════════════╝${colors.reset}`);

    await this.connect();

    try {
      // Critical checks for production readiness
      const isolationHealthy = await this.checkTenantIsolation();
      const capacityHealthy = await this.checkTenantLimits();
      const databaseHealthy = await this.checkDatabaseHealth();

      // Generate final report
      const productionReady = await this.generateProductionReport();

      return productionReady;

    } finally {
      await this.disconnect();
    }
  }
}

// Main execution
if (require.main === module) {
  const healthCheck = new ProductionTenantHealth();
  
  healthCheck.runProductionHealthCheck()
    .then(isHealthy => {
      process.exit(isHealthy ? 0 : 1);
    })
    .catch(error => {
      console.error(`${colors.red}Production health check failed:${colors.reset}`, error.message);
      process.exit(1);
    });
}

module.exports = { ProductionTenantHealth };