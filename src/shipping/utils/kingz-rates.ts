/**
 * Kingz International Logistics rate table (USA → Nigeria/Africa).
 * Update these constants when Kingz announces a rate change — no code
 * restructuring needed, just update the numbers here.
 */

/** Air freight rate per billable lb for Lagos delivery */
export const AIR_RATE_LAGOS_PER_LB = 5.0;

/** Air freight rate per billable lb for outside-Lagos delivery */
export const AIR_RATE_OUTSIDE_LAGOS_PER_LB = 6.0;

/** Divisor used to calculate dimensional (volumetric) weight: (L×W×H) / DIM_DIVISOR */
export const DIM_DIVISOR = 166;

/** Minimum charge for Lagos shipments below MIN_WEIGHT_LBS */
export const AIR_MINIMUM_LAGOS = 75.0;

/** Minimum charge for outside-Lagos shipments below MIN_WEIGHT_LBS */
export const AIR_MINIMUM_OUTSIDE_LAGOS = 100.0;

/** Anything below this weight in lbs uses the flat minimum instead of per-lb rate */
export const MIN_WEIGHT_LBS = 15;

/** Surcharge added for bulk / commercial items */
export const BULK_COMMERCIAL_SURCHARGE = 100.0;

/** Flat TV clearing fee added on top of the standard weight-based rate */
export const TV_CLEARING_FEE = 300.0;

/** Flat rate for a small ocean box (approx 16×16×16 in) */
export const OCEAN_SMALL_BOX_RATE = 100.0;

export type ShippingService = 'air' | 'ocean_small';
export type ShippingDestination = 'lagos' | 'outside_lagos';
