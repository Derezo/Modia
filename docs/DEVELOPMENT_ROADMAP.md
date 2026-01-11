# Modia - Development Roadmap

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 9.0 |
| Last Updated | January 2026 |

---

## Roadmap Structure

The roadmap is split into two focused documents:

| Document | Focus | Link |
|----------|-------|------|
| **ROADMAP_TECHNICAL.md** | Infrastructure, deployment, testing, performance, CI/CD | [View](./ROADMAP_TECHNICAL.md) |
| **ROADMAP_GAMEPLAY.md** | Features, mechanics, UX, content, settings | [View](./ROADMAP_GAMEPLAY.md) |

> **Completed milestones** are archived in `docs/archive/COMPLETED_MILESTONES.md`

---

## Overall Status

| Track | Completion | Status |
|-------|------------|--------|
| Technical | 35% | In Progress |
| Gameplay | 90% | Near Complete |
| **Combined** | **~70%** | In Progress |

---

## Phase Summary

| Phase | Name | Completion | Status |
|-------|------|------------|--------|
| 1 | Foundation | 100% | Complete |
| 2 | Characters & World | 95% | Near Complete |
| 3 | Combat System | 90% | Near Complete |
| 4 | Economy & Inventory | 95% | Near Complete |
| 5 | Multiplayer | 90% | Near Complete |
| 6 | Polish & Launch | 45% | In Progress |

---

## Current Sprint Focus

### High Priority - Gameplay

| Item | Location | Status |
|------|----------|--------|
| Quest System | advancementQuest.js | Complete |
| Node Blocking | world.js, WorldMapScene.js | Complete |
| Settings Expansion | SettingsScene.js | Not Started |

### High Priority - Technical

| Item | Location | Details |
|------|----------|---------|
| VPS Deployment | Infrastructure | Server setup, Nginx, SSL |
| E2E Tests | Playwright | Full gameplay coverage |
| Performance Audit | All | API, DB, frontend profiling |

---

## Quick Links

### Documentation
- [Technical Architecture](./TECHNICAL_ARCHITECTURE.md)
- [API Specification](./API_SPECIFICATION.md)
- [Game Design](./GAME_DESIGN.md)

### Design Documents
- [Marketplace Augments](./plans/2026-01-11-marketplace-item-augments-design.md)

### Archives
- [Completed Milestones](./archive/COMPLETED_MILESTONES.md)

---

## Success Metrics

### Technical Targets

| Metric | Target |
|--------|--------|
| API uptime | 99% |
| API response time (p95) | < 200ms |
| WebSocket latency | < 100ms |
| Error rate | < 1% |
| Concurrent users | 25 |

### Gameplay Targets

| Metric | Target |
|--------|--------|
| Session duration | > 15 min |
| Battle completion rate | > 80% |
| Daily active users | Track |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 9.0 | Jan 2026 | Split roadmap into ROADMAP_TECHNICAL.md and ROADMAP_GAMEPLAY.md. Added quest system, node blocking, settings expansion to gameplay track. |
| 8.0 | Jan 2026 | Major cleanup, archived completed milestones |
| 7.0-7.6 | Jan 2026 | Social/PvP, parchment UI, world map, boss mechanics, title animation |
| 6.0-6.2 | Jan 2026 | Advanced AI, guild recruitment, code review |
| 1.0-5.1 | Jan 2026 | Initial development through multiplayer |
