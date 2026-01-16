# Modia - Technical Roadmap

## Document Information

| Field | Value |
|-------|-------|
| Version | 1.5 |
| Last Updated | January 2026 |
| Focus | Infrastructure, deployment, testing, performance |

---

## Status Summary

| Category | Completion | Status |
|----------|------------|--------|
| Infrastructure | 60% | In Progress |
| CI/CD Pipeline | 40% | In Progress |
| Testing | 70% | In Progress |
| Performance | 30% | In Progress |
| Monitoring | 20% | In Progress |

---

## 1. Infrastructure & Deployment

### 1.1 VPS Server Setup

- [ ] Provision VPS (4GB RAM target)
- [ ] Configure firewall (ufw)
- [ ] Set up SSH keys
- [ ] Configure fail2ban

### 1.2 Database

- [x] PostgreSQL 14+ installation (via Docker Compose for dev, setup.sh for production)
- [x] Database user configuration (via setup.sh)
- [ ] Connection pooling (pgBouncer)
- [x] Automated backups (backup.sh with 7-day retention)

### 1.3 Application Server

- [x] Node.js 20+ LTS installation (via setup.sh)
- [x] PM2 process manager setup (via setup.sh, ecosystem.config.js)
- [x] Environment variable management (.env template in deploy/)
- [ ] Log rotation configuration

### 1.4 Web Server

- [x] Nginx installation (via setup.sh)
- [x] Reverse proxy configuration (nginx.conf.template)
- [x] Gzip compression (nginx.conf.template)
- [x] Static asset caching (nginx.conf.template)
- [x] WebSocket upgrade handling (nginx.conf.template)

### 1.5 Security

- [ ] SSL certificate (Let's Encrypt)
- [ ] Auto-renewal configuration
- [ ] Security headers (CSP, HSTS)
- [ ] Rate limiting at Nginx level

### 1.6 Domain

- [ ] Domain registration
- [ ] DNS configuration
- [ ] Subdomain setup (api.*, ws.*)

---

## 2. CI/CD Pipeline

### 2.1 GitHub Actions

- [ ] Lint on push
- [ ] Test on pull request
- [ ] Build validation
- [ ] Dependency security scanning

### 2.2 Deployment Scripts

- [x] Zero-downtime deployment (v8.7: deploy.sh with PM2 reload)
- [x] Database migration automation (v8.7: deploy.sh runs migrations)
- [x] Rollback procedures (v8.7: deploy.sh --rollback)
- [ ] Environment synchronization

### 2.3 Environment Management

- [ ] Staging environment
- [ ] Production environment
- [ ] Environment parity
- [ ] Secret management

---

## 3. Testing

### 3.1 Unit Tests

- [x] Auth service tests
- [x] Battle mechanics tests (75+)
- [x] Chat service tests (21)
- [x] Presence service tests (27)
- [x] WebSocket tests (44)
- [x] Order expiration service tests (orderExpirationService.unit.test.js)
- [x] Shop refresh service tests (shopRefreshService.unit.test.js)
- [ ] Quest service tests (pending implementation)
- [ ] Settings service tests

### 3.2 Integration Tests

- [x] API endpoint tests
- [x] WebSocket integration tests
- [x] Battle reconnection tests (battleReconnection.integration.test.js)
- [x] Coliseum service tests (coliseumService.integration.test.js)
- [x] Item drop service tests (itemDropService.integration.test.js)
- [x] Party WebSocket tests (partyWebsocket.integration.test.js)
- [x] Marketplace API tests (marketplace.integration.test.js)
- [ ] Database transaction tests
- [ ] Migration rollback tests

### 3.3 E2E Tests (Playwright)

- [x] Auth flow
- [ ] Character creation flow
- [ ] Battle flow
- [ ] Shop/marketplace flow
- [ ] Full gameplay walkthrough

### 3.4 Cross-Platform Testing

- [ ] Chrome (desktop)
- [ ] Firefox (desktop)
- [ ] Safari (desktop)
- [ ] Chrome (mobile)
- [ ] Safari (iOS)
- [ ] Edge

### 3.5 Load Testing

- [ ] 25 concurrent users
- [ ] WebSocket connection handling
- [ ] Database query performance
- [ ] Memory stability over time

### 3.6 Security Audit

- [ ] OWASP Top 10 review
- [ ] SQL injection verification
- [ ] XSS prevention verification
- [x] JWT token security (v8.7: 1h access tokens, auto-refresh, per-user rate limits)
- [x] Rate limiting verification (tests added v7.8)
- [x] Configure `trust proxy` for production deployment (v8.7)
- [x] Add rate limiter to auth/refresh endpoint (v8.7: 20/15min IP-based)
- [x] Add rate limiter to world/travel endpoint (v8.7: 60/min per-user)
- [ ] Review WebSocket rate limit persistence

---

## 4. Performance Optimization

### 4.1 API Performance

- [ ] Response time audit (target: p95 < 200ms)
- [ ] Slow query identification
- [ ] Endpoint profiling
- [ ] Cache header optimization

### 4.2 Database Performance

- [ ] Query optimization
- [ ] Index analysis
- [ ] Connection pool tuning
- [ ] EXPLAIN ANALYZE on slow queries

### 4.3 Frontend Performance

- [ ] Canvas render profiling
- [ ] Asset loading optimization
- [ ] Bundle size analysis
- [ ] Memory leak detection
- [ ] RequestAnimationFrame efficiency

### 4.4 WebSocket Efficiency

- [ ] Message size audit
- [ ] Heartbeat tuning
- [ ] Room subscription cleanup
- [ ] Connection multiplexing

### 4.5 Asset Optimization

- [ ] Image compression
- [ ] Sprite sheet optimization
- [ ] Lazy loading strategy
- [ ] Cache busting

---

## 5. Monitoring & Operations

### 5.1 Health Checks

- [ ] API health endpoint
- [ ] Database connectivity check
- [ ] WebSocket health check
- [ ] Disk space monitoring

### 5.2 Error Tracking

- [ ] Error logging service
- [ ] Alerting configuration
- [ ] Error categorization
- [ ] Stack trace preservation

### 5.3 Performance Monitoring

- [ ] Response time tracking
- [ ] Error rate tracking
- [ ] Memory usage tracking
- [ ] Database connection tracking

### 5.4 Backup Strategy

- [x] Database backup schedule (v8.7: backup.sh with cron)
- [x] Backup verification (v8.7: pg_restore --list validation)
- [ ] Point-in-time recovery
- [ ] Off-site backup storage (v8.7: backup.sh --s3 support ready)

---

## 6. Technical Debt

### 6.1 Known Issues

| Issue | Location | Priority |
|-------|----------|----------|
| In-memory rate limit state (no distributed storage) | rateLimiterFactory.js | High |
| WebSocket rate limits reset on reconnection | websocket/index.js:92-94 | High |
| Event name mismatch (party:invite) | Game.js / partyWebsocket.js | Medium |
| Inline listeners without cleanup | LoginScene.js, WorldMapScene.js | Medium |
| Missing rate limiters on inventory endpoints | inventory.js | Medium |
| API response format inconsistency | Various routes | Low |
| Debug endpoint in production | battle.js:verify-traits | Low |
| SkillTreePanel.js potentially unused | frontend/src/components/ | Low |

### 6.2 Refactoring Opportunities

- [x] **seed.js modularization** - Reduced from 4862 to 918 lines via worldgen/ modules
- [x] **Database performance indexes** - Composite indexes for regional queries (030_performance_indexes.sql)
- [ ] Consolidate settings modal and scene
- [ ] Unify WebSocket event naming
- [ ] Add TypeScript types (future)
- [ ] API response standardization
- [ ] Database audit trail for gold/item changes (track before/after values)
- [ ] Request validation layer (Zod schemas for consistent input validation)
- [ ] Distributed rate limiting (Redis) for horizontal scaling
- [ ] Structured logging with request correlation IDs

### 6.3 Future Infrastructure

| Item | Priority | Notes |
|------|----------|-------|
| API versioning (/api/v1/...) | Low | Only when breaking changes needed |
| Database connection pooling (pgBouncer) | Medium | For horizontal scaling |
| Health check expansion | High | DB connectivity, WebSocket status, memory metrics |
| Log aggregation service | Medium | JSON structured logs for monitoring |

---

## Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| API uptime | 99% | N/A |
| API response time (p95) | < 200ms | ~150ms |
| WebSocket latency | < 100ms | ~50ms |
| Error rate | < 1% | ~0.5% |
| Concurrent users | 25 | Untested |
| Test coverage | 80% | ~65% |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.5 | Jan 2026 | Project cleanup audit: Updated infrastructure completion (60%), marked VPS deployment items as complete (setup.sh, deploy.sh, nginx.conf.template, backup.sh). Added new known issues (inventory rate limits, API inconsistency, debug endpoints). Added refactoring opportunities (audit trail, Zod validation, Redis rate limiting, structured logging). Added Future Infrastructure section. Installed knip for dead code analysis. |
| 1.4 | Jan 2026 | Security & Infrastructure (v8.7): Trust proxy config for proper IP detection. Per-user rate limiting for authenticated requests. New rate limiters: auth/refresh (20/15min), world/travel (60/min), gameplay actions (skill 30/min, inventory 45/min). Increased global limits (300 base). JWT extended to 1h with automatic refresh. TokenRefreshManager for seamless token renewal. VPS deployment scripts: setup.sh, deploy.sh (zero-downtime), nginx.conf.template, backup.sh (7-day retention). |
| 1.3 | Jan 2026 | Technical debt cleanup: seed.js modularization (4862→918 lines, 12 new modules), WorldMapScene pathPreviewCache LRU limits, composite database indexes (030_performance_indexes.sql). |
| 1.2 | Jan 2026 | ItemDataTable & Marketplace plan complete: Added marketplace integration tests, order expiration unit tests, shop refresh unit tests. Testing updated to 70%. |
| 1.1 | Jan 2026 | Roadmap audit v8.0: Added completed integration tests (battle reconnection, coliseum, item drop, party websocket). Updated testing completion to 65%. |
| 1.0 | Jan 2026 | Initial split from DEVELOPMENT_ROADMAP.md |
