// Names registered on the blockchain for brands and marketplaces, as address -> name.
// One wallet can be both a brand and a marketplace. The marketplace name is shown while that marketplace is
// switched on; once the admin switches it off, the brand name is shown again.

/** @returns {Map<string, string>} lowercase address -> name */
export function onChainNames(brands, marketplaces) {
  const names = new Map();
  for (const brand of brands) if (brand.name) names.set(brand.address.toLowerCase(), brand.name);
  for (const market of marketplaces) {
    if (!market.name) continue;
    const key = market.address.toLowerCase();
    if (market.active || !names.has(key)) names.set(key, market.name);
  }
  return names;
}
