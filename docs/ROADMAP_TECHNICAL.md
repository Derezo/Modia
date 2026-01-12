# Modia - Technical Roadmap

## Document Information

| Field | Value |
|-------|-------|
| Version | 1.1 |
| Last Updated | January 2026 |
| Focus | Infrastructure, deployment, testing, performance |

---

## Status Summary

| Category | Completion | Status |
|----------|------------|--------|
| Infrastructure | 0% | Not Started |
| CI/CD Pipeline | 0% | Not Started |
| Testing | 65% | In Progress |
| Performance | 30% | In Progress |
| Monitoring | 0% | Not Started |

---

## 1. Infrastructure & Deployment

### 1.1 VPS Server Setup

- [ ] Provision VPS (4GB RAM target)
- [ ] Configure firewall (ufw)
- [ ] Set up SSH keys
- [ ] Configure fail2ban

### 1.2 Database

- [ ] PostgreSQL 14+ installation
- [ ] Database user configuration
- [ ] Connection pooling (pgBouncer)
- [ ] Automated backups

### 1.3 Application Server

- [ ] Node.js 20+ LTS installation
- [ ] PM2 process manager setup
- [ ] Environment variable management
- [ ] Log rotation configuration

### 1.4 Web Server

- [ ] Nginx installation
- [ ] Reverse proxy configuration
- [ ] Gzip compression
- [ ] Static asset caching
- [ ] WebSocket upgrade handling

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

- [ ] Zero-downtime deployment
- [ ] Database migration automation
- [ ] Rollback procedures
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
- [ ] Quest service tests (pending implementation)
- [ ] Settings service tests

### 3.2 Integration Tests

- [x] API endpoint tests
- [x] WebSocket integration tests
- [x] Battle reconnection tests (battleReconnection.integration.test.js)
- [x] Coliseum service tests (coliseumService.integration.test.js)
- [x] Item drop service tests (itemDropService.integration.test.js)
- [x] Party WebSocket tests (partyWebsocket.integration.test.js)
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
- [ ] JWT token security
- [x] Rate limiting verification (tests added v7.8)
- [ ] Configure `trust proxy` for production deployment
- [ ] Add rate limiter to auth/refresh endpoint
- [ ] Add rate limiter to world/travel endpoint
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

- [ ] Database backup schedule
- [ ] Backup verification
- [ ] Point-in-time recovery
- [ ] Off-site backup storage

---

## 6. Technical Debt

### 6.1 Known Issues

| Issue | Location | Priority |
|-------|----------|----------|
| Missing `trust proxy` config (IP spoofing risk) | index.js, rateLimiterFactory.js | Critical |
| Token refresh endpoint not rate limited | auth.js:137 | Critical |
| In-memory rate limit state (no distributed storage) | rateLimiterFactory.js | High |
| WebSocket rate limits reset on reconnection | websocket/index.js:92-94 | High |
| Missing rate limiter on /api/world/travel | world.js:316 | High |
| Production rate limits 2x multiplier too permissive | rateLimiterFactory.js:33-44 | High |
| WorldMapScene pathPreviewCache unbounded growth | WorldMapScene.js:74 | Medium |
| Event name mismatch (party:invite) | Game.js / partyWebsocket.js | Medium |
| SettingsModal.js orphaned | frontend/src/components/ | Low |
| Inline listeners without cleanup | LoginScene.js, WorldMapScene.js | Medium |

### 6.2 Refactoring Opportunities

- [ ] Consolidate settings modal and scene
- [ ] Unify WebSocket event naming
- [ ] Add TypeScript types (future)
- [ ] API response standardization

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
| 1.1 | Jan 2026 | Roadmap audit v8.0: Added completed integration tests (battle reconnection, coliseum, item drop, party websocket). Updated testing completion to 65%. |
| 1.0 | Jan 2026 | Initial split from DEVELOPMENT_ROADMAP.md |
