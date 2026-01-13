# Modia - Development Roadmap

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 16.0 |
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
| Technical | 30% | In Progress |
| Gameplay | 90% | Near Complete |
| **Combined** | **~70%** | In Progress |

---

## Phase Summary

| Phase | Name | Completion | Status |
|-------|------|------------|--------|
| 1 | Foundation | 100% | Complete |
| 2 | Characters & World | 95% | Near Complete |
| 3 | Combat System | 85% | In Progress |
| 4 | Economy & Inventory | 90% | Near Complete |
| 5 | Multiplayer | 80% | In Progress |
| 6 | Polish & Launch | 50% | In Progress |

---

## Current Sprint Focus

### High Priority - Gameplay

| Item | Location | Status |
|------|----------|--------|
| Social Hub (Friends, Party, Clans) | SocialHubScene.js, social/tabs/* | **COMPLETE** |
| Formation & Inventory Integration | FormationScene.js, modals/* | **COMPLETE** |
| Battle Balance (Defense) | battleService.js | Not Started |
| Gold Sinks | marketplace.js, world.js | Not Started |

### High Priority - Technical

| Item | Location | Details |
|------|----------|---------|
| Rate Limit Security | rateLimiterFactory.js, auth.js | trust proxy, refresh endpoint |
| VPS Deployment | Infrastructure | Server setup, Nginx, SSL |
| E2E Tests | Playwright | Full gameplay coverage |

---

## Quick Links

### Documentation
- [Technical Architecture](./TECHNICAL_ARCHITECTURE.md)
- [API Specification](./API_SPECIFICATION.md)
- [Game Design](./GAME_DESIGN.md)

### Design Documents
- [Formation & Inventory Integration](./plans/2026-01-12-formation-inventory-integration-design.md)
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
| 16.0 | Jan 2026 | World Map Enhancement: Terminator treasure nodes (chest/shrine/discovery), terrain obstacles (lakes, mountains, forests), compact node options panel with type badge, settlement adjacency rules preventing same-type connections, connection count constraints. 6 new API endpoints, 2 new migrations, security hardening (location validation, race condition prevention). |
| 15.0 | Jan 2026 | Character Portrait Enhancement v2: Comprehensive overhaul of 120 character portraits (5 races × 3 genders × 8 classes). Added gender-specific face rendering (face shapes, eyes, cheekbones). Enhanced race distinctiveness (vampire fangs 4px, elf circlet with gem, orc hair contrast, dwarf female sideburns). Improved class identity (warrior insignia, monk chi glow, sorcerer dark aura, ninja clan symbol/weapons, berserker rage glow). New utils: drawGenderedEyes(), drawCheekbones(), drawEyeGlow(), drawSymbol(), orcHair/darkMagic palettes. |
| 14.0 | Jan 2026 | Item Detail & Equip Modal Improvements: New statDisplay.js utility for consistent stat/augment formatting. ItemDetailModal shows full stat names and augment effect descriptions. EquipmentSlotModal redesigned with side-by-side comparison cards, stat changes summary, responsive mobile layout. |
| 13.0 | Jan 2026 | Profile Image Generation System (v8.2): Programmatic SVG portrait generation for 92 missing portraits (76 character + 16 enemy). New races: Dwarf, Vampire, Orc. All enemy types now have portraits. |
| 12.0 | Jan 2026 | Formation & Inventory Integration complete (v8.2): Modal-based party management with 9 new components (Accordion, CharacterCard, PartyStatsSummary, CharacterPicker, ItemsModal, ItemDetailModal, CharacterModal, EquipmentSlotModal, SkillDetailModal). FormationScene redesigned with character grid. InventoryScene/InventoryPanel deleted. User Experience at 85%. |
| 11.0 | Jan 2026 | Unified Social Hub complete (v8.0): SocialHubScene with 5 tabs (Friends, Party, Requests, LFG, Clan). Clan system MVP with create/join/invite/chat. CourtyardScene deprecated. Social features at 95%. |
| 10.0 | Jan 2026 | Roadmap audit v8.0: Corrected completion percentages across all phases. Updated sprint focus with Friends UI, PartyInviteModal, Battle Balance, Gold Sinks. Added rate limit security to technical priorities. |
| 9.0 | Jan 2026 | Split roadmap into ROADMAP_TECHNICAL.md and ROADMAP_GAMEPLAY.md. Added quest system, node blocking, settings expansion to gameplay track. |
| 8.0 | Jan 2026 | Major cleanup, archived completed milestones |
| 7.0-7.6 | Jan 2026 | Social/PvP, parchment UI, world map, boss mechanics, title animation |
| 6.0-6.2 | Jan 2026 | Advanced AI, guild recruitment, code review |
| 1.0-5.1 | Jan 2026 | Initial development through multiplayer |
