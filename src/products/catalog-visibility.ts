import { UserRole } from '../common/enums/role.enum';

/** Signed-in shopper, when a public catalog route could read the access token. */
export type CatalogViewer = { sub: string; role: UserRole } | null | undefined;

/**
 * Unpriced customer manual requests stay out of the public catalog.
 * Once an admin sets a price (`sale_price` > 0) the product is public
 * and the storefront marks it with a manual-import badge.
 */
export function catalogVisibilitySql(alias: string): { sql: string; params: Record<string, string> } {
  return {
    sql: `NOT (
      ${alias}.rescrape_enabled = false
      AND ${alias}.sale_price <= 0
      AND EXISTS (
        SELECT 1 FROM imported_products req
        WHERE req.product_id = ${alias}.id
          AND req.requested_by_user_id IS NOT NULL
      )
    )`,
    params: {},
  };
}
