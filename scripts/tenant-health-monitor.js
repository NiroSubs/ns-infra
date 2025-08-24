#!/usr/bin/env node

const { Client } = require('pg');
const https = require('https');
const http = require('http');

// Tenant health monitoring configuration
const config = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'visualforge',
    user: process.env.DB_USER || 'apiuser',
    password: process.env.DB_PASSWORD || 'vsForgeP@ss!'
  },
  monitoring: {
    checkInterval: process.env.MONITOR_INTERVAL || 300000, // 5 minutes
    alertThresholds: {
      responseTime: parseInt(process.env.RESPONSE_TIME_THRESHOLD) || 5000, // 5 seconds
      errorRate: parseFloat(process.env.ERROR_RATE_THRESHOLD) || 0.1, // 10%
      tenantIsolationViolations: 0 // Zero tolerance
    }
  },
  services: {
    auth: process.env.AUTH_SERVICE_URL || 'http://localhost:4000',
    user: process.env.USER_SERVICE_URL || 'http://localhost:4001',
    dashboard: process.env.DASHBOARD_SERVICE_URL || 'http://localhost:4002',
    payments: process.env.PAYMENTS_SERVICE_URL || 'http://localhost:4003'
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

class TenantHealthMonitor {
  constructor() {
    this.db = null;
    this.healthMetrics = {
      tenants: [],
      services: {},
      alerts: []
    };
  }

  async connect() {
    try {
      this.db = new Client(config.database);
      await this.db.connect();
      console.log(`${colors.green}✓${colors.reset} Connected to PostgreSQL database`);
    } catch (error) {
      console.error(`${colors.red}✗${colors.reset} Database connection failed:`, error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.db) {
      await this.db.end();
      console.log(`${colors.blue}ℹ${colors.reset} Database connection closed`);
    }
  }

  async getTenants() {
    try {
      const result = await this.db.query(`
        SELECT 
          id,
          name,
          slug,
          plan,
          status,
          created_at,
          updated_at,
          features,
          limits
        FROM tenants 
        WHERE status = 'active'
        ORDER BY created_at DESC
      `);
      
      return result.rows;
    } catch (error) {
      console.error(`${colors.red}✗${colors.reset} Failed to fetch tenants:`, error.message);
      return [];
    }
  }

  async checkTenantIsolation() {
    console.log(`\n${colors.blue}═══ Tenant Isolation Health ═══${colors.reset}`);
    
    const violations = [];
    
    try {
      // Check for data leakage between tenants
      const leakageCheck = await this.db.query(`
        WITH tenant_data_counts AS (
          SELECT 
            t.id as tenant_id,
            t.name as tenant_name,
            COUNT(CASE WHEN tu.tenant_id != t.id THEN 1 END) as mismatched_users,
            COUNT(CASE WHEN tus.tenant_id != t.id THEN 1 END) as mismatched_usage
          FROM tenants t
          LEFT JOIN tenant_users tu ON tu.tenant_id = t.id
          LEFT JOIN tenant_usage_stats tus ON tus.tenant_id = t.id
          WHERE t.status = 'active'
          GROUP BY t.id, t.name
        )
        SELECT * FROM tenant_data_counts
        WHERE mismatched_users > 0 OR mismatched_usage > 0
      `);
      
      if (leakageCheck.rows.length > 0) {
        leakageCheck.rows.forEach(row => {
          violations.push(`Tenant ${row.tenant_name}: ${row.mismatched_users} user violations, ${row.mismatched_subscriptions} subscription violations`);
        });
      }
      
      // Check for orphaned data
      const orphanCheck = await this.db.query(`
        SELECT 
          'tenant_users' as table_name,
          COUNT(*) as orphan_count
        FROM tenant_users tu 
        LEFT JOIN tenants t ON tu.tenant_id = t.id 
        WHERE t.id IS NULL
        UNION ALL
        SELECT 
          'tenant_usage_stats' as table_name,
          COUNT(*) as orphan_count
        FROM tenant_usage_stats tus
        LEFT JOIN tenants t ON tus.tenant_id = t.id 
        WHERE t.id IS NULL
      `);
      
      orphanCheck.rows.forEach(row => {
        if (row.orphan_count > 0) {
          violations.push(`${row.orphan_count} orphaned records in ${row.table_name} table`);
        }
      });
      
      if (violations.length === 0) {
        console.log(`${colors.green}✓${colors.reset} Tenant isolation - No violations detected`);
      } else {
        console.log(`${colors.red}✗${colors.reset} Tenant isolation - ${violations.length} violations:`);
        violations.forEach(v => console.log(`  - ${v}`));
        this.healthMetrics.alerts.push({
          type: 'CRITICAL',
          service: 'Database',
          message: `Tenant isolation violations: ${violations.join(', ')}`,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error(`${colors.red}✗${colors.reset} Tenant isolation check failed:`, error.message);
      violations.push(`Isolation check failed: ${error.message}`);
    }
    
    return violations;
  }

  async checkTenantPerformance() {
    console.log(`\n${colors.blue}═══ Tenant Performance Health ═══${colors.reset}`);
    
    try {
      const perfCheck = await this.db.query(`
        WITH tenant_metrics AS (
          SELECT 
            t.id,
            t.name,
            t.plan,
            COUNT(tu.id) as user_count,
            COALESCE(SUM(tus.api_calls_count), 0) as api_calls_count,
            COALESCE(t.limits->>'users', '999999')::int as max_users,
            COALESCE(t.limits->>'apiCalls', '999999')::int as max_api_calls
          FROM tenants t
          LEFT JOIN tenant_users tu ON tu.tenant_id = t.id AND tu.status = 'active'
          LEFT JOIN tenant_usage_stats tus ON tus.tenant_id = t.id AND tus.stat_date >= CURRENT_DATE - 30
          WHERE t.status = 'active'
          GROUP BY t.id, t.name, t.plan, t.limits
        )
        SELECT 
          *,
          CASE WHEN max_users = -1 THEN 0 ELSE CAST((user_count::float / max_users) * 100 AS INTEGER) END as user_utilization,
          CASE WHEN max_api_calls = -1 THEN 0 ELSE CAST((api_calls_count::float / max_api_calls) * 100 AS INTEGER) END as api_utilization,
          CASE 
            WHEN max_users = -1 THEN 'UNLIMITED'
            WHEN user_count >= max_users THEN 'EXCEEDED'
            WHEN user_count > max_users * 0.8 THEN 'HIGH'
            ELSE 'OK'
          END as user_status,
          CASE 
            WHEN max_api_calls = -1 THEN 'UNLIMITED'
            WHEN api_calls_count >= max_api_calls THEN 'EXCEEDED'
            WHEN api_calls_count > max_api_calls * 0.8 THEN 'HIGH'
            ELSE 'OK'
          END as api_status
        FROM tenant_metrics
        ORDER BY user_count DESC
      `);
      
      let healthyTenants = 0;
      let warningTenants = 0;
      let criticalTenants = 0;
      
      perfCheck.rows.forEach(tenant => {
        const hasExceeded = tenant.user_status === 'EXCEEDED' || tenant.api_status === 'EXCEEDED';
        const hasWarning = tenant.user_status === 'HIGH' || tenant.api_status === 'HIGH';
        const isUnlimited = tenant.user_status === 'UNLIMITED' || tenant.api_status === 'UNLIMITED';
        
        const userDisplay = tenant.max_users === -1 ? '∞' : tenant.max_users;
        const apiDisplay = tenant.max_api_calls === -1 ? '∞' : tenant.max_api_calls;
        const userUtil = tenant.user_utilization || 0;
        const apiUtil = tenant.api_utilization || 0;
        
        if (hasExceeded) {
          console.log(`${colors.red}✗${colors.reset} ${tenant.name} - CRITICAL: Users: ${tenant.user_count}/${userDisplay} (${userUtil}%), API: ${tenant.api_calls_count}/${apiDisplay} (${apiUtil}%)`);
          criticalTenants++;
          this.healthMetrics.alerts.push({
            type: 'CRITICAL',
            service: 'Tenant Limits',
            message: `Tenant ${tenant.name} has exceeded limits`,
            timestamp: new Date().toISOString()
          });
        } else if (hasWarning) {
          console.log(`${colors.yellow}⚠${colors.reset} ${tenant.name} - WARNING: Users: ${tenant.user_count}/${userDisplay} (${userUtil}%), API: ${tenant.api_calls_count}/${apiDisplay} (${apiUtil}%)`);
          warningTenants++;
        } else {
          console.log(`${colors.green}✓${colors.reset} ${tenant.name} - OK: Users: ${tenant.user_count}/${userDisplay} (${userUtil}%), API: ${tenant.api_calls_count}/${apiDisplay} (${apiUtil}%)`);
          healthyTenants++;
        }
      });
      
      console.log(`\nTenant Performance Summary: ${healthyTenants} healthy, ${warningTenants} warnings, ${criticalTenants} critical`);
      
    } catch (error) {
      console.error(`${colors.red}✗${colors.reset} Tenant performance check failed:`, error.message);
    }
  }

  async checkServiceHealth() {
    console.log(`\n${colors.blue}═══ Service Health Check ═══${colors.reset}`);
    
    const services = Object.entries(config.services);
    const results = await Promise.all(
      services.map(async ([serviceName, baseUrl]) => {
        try {
          const startTime = Date.now();
          const response = await this.makeRequest(`${baseUrl}/api/health`);
          const responseTime = Date.now() - startTime;
          
          const isHealthy = response.statusCode === 200;
          const isSlow = responseTime > config.monitoring.alertThresholds.responseTime;
          
          if (isHealthy && !isSlow) {
            console.log(`${colors.green}✓${colors.reset} ${serviceName} - OK (${responseTime}ms)`);
          } else if (isHealthy && isSlow) {
            console.log(`${colors.yellow}⚠${colors.reset} ${serviceName} - SLOW (${responseTime}ms)`);
            this.healthMetrics.alerts.push({
              type: 'WARNING',
              service: serviceName,
              message: `Slow response time: ${responseTime}ms`,
              timestamp: new Date().toISOString()
            });
          } else {
            console.log(`${colors.red}✗${colors.reset} ${serviceName} - FAILED (${response.error || response.statusCode})`);
            this.healthMetrics.alerts.push({
              type: 'CRITICAL',
              service: serviceName,
              message: response.error || `HTTP ${response.statusCode}`,
              timestamp: new Date().toISOString()
            });
          }
          
          return { serviceName, healthy: isHealthy, responseTime };
        } catch (error) {
          console.log(`${colors.red}✗${colors.reset} ${serviceName} - ERROR (${error.message})`);
          return { serviceName, healthy: false, error: error.message };
        }
      })
    );
    
    return results;
  }

  makeRequest(url, timeout = 5000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const isHttps = url.startsWith('https:');
      const client = isHttps ? https : http;
      
      const request = client.get(url, { timeout }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            responseTime: Date.now() - startTime,
            data
          });
        });
      });
      
      request.on('error', (err) => {
        resolve({
          error: err.message,
          responseTime: Date.now() - startTime
        });
      });
      
      request.on('timeout', () => {
        request.destroy();
        resolve({
          error: 'Request timeout',
          responseTime: timeout
        });
      });
    });
  }

  async generateReport() {
    console.log(`\n${colors.blue}${colors.bold}╔════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}║         TENANT HEALTH SUMMARY          ║${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}╚════════════════════════════════════════╝${colors.reset}`);
    
    const tenants = await this.getTenants();
    console.log(`Total Active Tenants: ${tenants.length}`);
    
    const criticalAlerts = this.healthMetrics.alerts.filter(a => a.type === 'CRITICAL').length;
    const warningAlerts = this.healthMetrics.alerts.filter(a => a.type === 'WARNING').length;
    
    console.log(`${colors.red}Critical Alerts: ${criticalAlerts}${colors.reset}`);
    console.log(`${colors.yellow}Warning Alerts: ${warningAlerts}${colors.reset}`);
    
    if (criticalAlerts > 0) {
      console.log(`\n${colors.red}${colors.bold}🚨 CRITICAL ISSUES DETECTED${colors.reset}`);
      this.healthMetrics.alerts
        .filter(a => a.type === 'CRITICAL')
        .forEach(alert => {
          console.log(`   ❌ ${alert.service}: ${alert.message}`);
        });
      return false;
    } else if (warningAlerts > 0) {
      console.log(`\n${colors.yellow}${colors.bold}⚠️  WARNINGS DETECTED${colors.reset}`);
      this.healthMetrics.alerts
        .filter(a => a.type === 'WARNING')
        .forEach(alert => {
          console.log(`   ⚠️  ${alert.service}: ${alert.message}`);
        });
      return true;
    } else {
      console.log(`\n${colors.green}${colors.bold}✅ ALL SYSTEMS HEALTHY${colors.reset}`);
      return true;
    }
  }

  async runFullHealthCheck() {
    console.log(`${colors.blue}${colors.bold}╔════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}║      TENANT HEALTH MONITORING          ║${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}║      ${new Date().toISOString()}     ║${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}╚════════════════════════════════════════╝${colors.reset}`);
    
    await this.connect();
    
    try {
      // Check tenant isolation
      await this.checkTenantIsolation();
      
      // Check tenant performance
      await this.checkTenantPerformance();
      
      // Check service health
      await this.checkServiceHealth();
      
      // Generate final report
      const isHealthy = await this.generateReport();
      
      return isHealthy;
      
    } finally {
      await this.disconnect();
    }
  }
}

// Main execution
if (require.main === module) {
  const monitor = new TenantHealthMonitor();
  
  monitor.runFullHealthCheck()
    .then(isHealthy => {
      process.exit(isHealthy ? 0 : 1);
    })
    .catch(error => {
      console.error(`${colors.red}Health monitoring failed:${colors.reset}`, error.message);
      process.exit(1);
    });
}

module.exports = { TenantHealthMonitor };