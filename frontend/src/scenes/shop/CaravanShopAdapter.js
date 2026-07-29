/**
 * Normalize both the canonical shop response and the original caravan-only
 * response. This keeps the scene functional during a rolling API deployment.
 */
export function normalizeCaravanShopData(caravanData, { now = Date.now() } = {}) {
  const sourceItems = Array.isArray(caravanData?.items)
    ? caravanData.items
    : (Array.isArray(caravanData?.inventory) ? caravanData.inventory : []);

  const items = sourceItems.map(item => {
    const id = item.id ?? item.itemId;
    const regionalSpecialty = item.regionalSpecialty
      ?? (item.regional ? 'Regional Specialty' : null);
    const equipmentSlot = item.equipmentSlot ?? item.equipSlot ?? null;

    return {
      ...item,
      id,
      itemId: item.itemId ?? id,
      regionalSpecialty,
      equipmentSlot
    };
  });

  let nextRefresh = null;
  if (caravanData?.nextRefresh) {
    nextRefresh = new Date(caravanData.nextRefresh);
  } else if (Number.isFinite(caravanData?.refreshesIn)) {
    nextRefresh = new Date(now + Math.max(0, caravanData.refreshesIn));
  }

  if (nextRefresh && !Number.isFinite(nextRefresh.getTime())) {
    nextRefresh = null;
  }

  return { items, nextRefresh };
}

export function formatCaravanRefreshCountdown(nextRefresh, { now = Date.now() } = {}) {
  const deadline = nextRefresh instanceof Date ? nextRefresh : new Date(nextRefresh);
  if (!nextRefresh || !Number.isFinite(deadline.getTime())) {
    return 'Refresh time unavailable';
  }

  const diff = deadline.getTime() - now;
  if (diff <= 0) return 'Refreshing soon...';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0
    ? `Refreshes in ${hours}h ${minutes}m`
    : `Refreshes in ${minutes}m`;
}
