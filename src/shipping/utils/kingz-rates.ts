/**
 * Kingz International Logistics rate table (USA → Nigeria).
 * Scraped from https://www.kingzlogistics.com/quote — last verified 2026-06-20.
 * Update these constants when Kingz announces a rate change — no code
 * restructuring needed, just update the numbers here.
 */

// ─── Air Freight ────────────────────────────────────────────────────────────

/**
 * Air freight rate per billable lb (USA → Nigeria, all delivery types).
 * Lagos office pickup, self-pickup, and door-to-door all share this rate.
 * Previously separate Lagos ($5.00) / outside-Lagos ($6.00) rates — now unified at $5.50.
 */
export const AIR_RATE_PER_LB = 5.5;

/** @deprecated Use AIR_RATE_PER_LB — Kingz now uses a single rate for all destinations */
export const AIR_RATE_LAGOS_PER_LB = AIR_RATE_PER_LB;

/** @deprecated Use AIR_RATE_PER_LB — Kingz now uses a single rate for all destinations */
export const AIR_RATE_OUTSIDE_LAGOS_PER_LB = AIR_RATE_PER_LB;

/** Divisor used to calculate dimensional (volumetric) weight: (L×W×H in inches) / DIM_DIVISOR */
export const DIM_DIVISOR = 166;

/**
 * Weight threshold in lbs below which the weight is rounded up to the next integer.
 * Matches Kingz website `bawt` variable (break-above weight).
 */
export const MIN_WEIGHT_LBS = 15;

/**
 * Small-package surcharge added for self-pickup / door-to-door deliveries
 * on shipments at or below MIN_WEIGHT_LBS. Not applied for Lagos office pickup.
 * Matches Kingz website `brate` / `brate_o` = 1.50.
 */
export const SMALL_PACKAGE_SURCHARGE = 1.5;

/**
 * No minimum charge applies — confirmed from Kingz site JS (brate_status='0', no floor variable set).
 * The calculator applies weight × $5.50 for all weights including sub-1 lb packages.
 * Kept as zero so ResolvedRates shape stays stable; not used in fare calculation.
 */
export const AIR_MINIMUM_LAGOS = 0;
export const AIR_MINIMUM_OUTSIDE_LAGOS = 0;

/** Surcharge added for bulk / commercial items (not shown on public calculator — confirm with Kingz) */
export const BULK_COMMERCIAL_SURCHARGE = 100.0;

/**
 * TV additional handling fee added on top of the weight-based air rate.
 * NOTE: Not shown on the Kingz public air calculator — confirm with Kingz directly.
 * The ocean freight starting rate for large TVs (>42") is $200 (see OCEAN_TV_RATE below).
 */
export const TV_CLEARING_FEE = 200.0;

// ─── Ocean Freight (Container) ───────────────────────────────────────────────
// Rates from the Kingz quote page goods/container selector.
// These are flat rates per item/box shipped via ocean container.

/** Ocean freight — Standard box approx 16×16×16 in */
export const OCEAN_SMALL_BOX_RATE = 75.0;

/** Ocean freight — 18×18×18 in box */
export const OCEAN_MED_BOX_RATE = 125.0;

/** Ocean freight — 22×22×22 in box */
export const OCEAN_LARGE_BOX_RATE = 150.0;

/** Ocean freight — Average size duffle bag */
export const OCEAN_DUFFLE_BAG_RATE = 175.0;

/** Ocean freight — Large wardrobe box (48×24×24 in) */
export const OCEAN_WARDROBE_RATE = 325.0;

/** Ocean freight — Large TV (>42") starting rate */
export const OCEAN_TV_RATE = 200.0;

/** Ocean freight — Small sedan (clearing NOT included) */
export const OCEAN_SMALL_SEDAN_RATE = 2000.0;

/** Ocean freight — Small SUV (clearing NOT included) */
export const OCEAN_SMALL_SUV_RATE = 2200.0;

/** Ocean freight — Large SUV (clearing NOT included) */
export const OCEAN_LARGE_SUV_RATE = 3500.0;

export type ShippingService = 'air' | 'ocean_small' | 'ocean_med' | 'ocean_large' | 'ocean_duffle' | 'ocean_wardrobe' | 'ocean_tv';
export type ShippingDestination = 'lagos' | 'outside_lagos';
