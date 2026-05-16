export const PRODUCT_CATEGORIES = [
  'sneakers',
  'clothing',
  'phone',
  'laptop',
  'tablet',
  'tv',
  'electronics_small',
  'electronics_large',
  'accessories',
  'books',
  'generic',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export type CategoryWeightRule = {
  /** Actual weight in pounds */
  weightLbs: number;
  /** Box length in inches */
  lengthIn: number;
  /** Box width in inches */
  widthIn: number;
  /** Box height in inches */
  heightIn: number;
};

/**
 * Default weight + dimension estimates by product category.
 * Used when the scraped product has no known weight/dimensions.
 * Based on typical retail packaging (product + box + padding).
 */
export const CATEGORY_WEIGHT_RULES: Record<
  ProductCategory,
  CategoryWeightRule
> = {
  sneakers: { weightLbs: 2.5, lengthIn: 14, widthIn: 9, heightIn: 6 },
  clothing: { weightLbs: 0.8, lengthIn: 12, widthIn: 10, heightIn: 3 },
  phone: { weightLbs: 1.0, lengthIn: 8, widthIn: 5, heightIn: 3 },
  laptop: { weightLbs: 5.5, lengthIn: 16, widthIn: 11, heightIn: 3 },
  tablet: { weightLbs: 2.5, lengthIn: 12, widthIn: 9, heightIn: 2 },
  tv: { weightLbs: 28.0, lengthIn: 62, widthIn: 38, heightIn: 7 },
  electronics_small: { weightLbs: 1.5, lengthIn: 10, widthIn: 8, heightIn: 4 },
  electronics_large: { weightLbs: 9.0, lengthIn: 22, widthIn: 18, heightIn: 12 },
  accessories: { weightLbs: 0.5, lengthIn: 8, widthIn: 6, heightIn: 3 },
  books: { weightLbs: 1.5, lengthIn: 10, widthIn: 8, heightIn: 2 },
  generic: { weightLbs: 2.0, lengthIn: 12, widthIn: 10, heightIn: 6 },
};
