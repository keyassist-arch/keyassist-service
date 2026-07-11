import { BadRequestException } from '@nestjs/common';
import { BatchStatus } from '../../common/enums/batch-status.enum';
import { WannaBuyItemStatus } from '../../common/enums/wanna-buy-item-status.enum';

/**
 * Strictly sequential, forward-only — one step at a time, no skipping ahead.
 * `CANCELLED` is reachable from any non-terminal status.
 */
export const BATCH_STATUS_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  [BatchStatus.COLLECTING]: [BatchStatus.PROCESSING, BatchStatus.CANCELLED],
  [BatchStatus.PROCESSING]: [BatchStatus.PLACING_ORDERS, BatchStatus.CANCELLED],
  [BatchStatus.PLACING_ORDERS]: [BatchStatus.IN_TRANSIT, BatchStatus.CANCELLED],
  [BatchStatus.IN_TRANSIT]: [BatchStatus.AT_WAREHOUSE, BatchStatus.CANCELLED],
  [BatchStatus.AT_WAREHOUSE]: [BatchStatus.SHIPPED, BatchStatus.CANCELLED],
  [BatchStatus.SHIPPED]: [BatchStatus.DELIVERED, BatchStatus.CANCELLED],
  [BatchStatus.DELIVERED]: [],
  [BatchStatus.CANCELLED]: [],
};

export const WANNA_BUY_ITEM_TRANSITIONS: Record<WannaBuyItemStatus, WannaBuyItemStatus[]> = {
  [WannaBuyItemStatus.PENDING]: [
    WannaBuyItemStatus.QUOTED,
    WannaBuyItemStatus.CANCELLED,
    WannaBuyItemStatus.EXPIRED,
  ],
  [WannaBuyItemStatus.QUOTED]: [
    WannaBuyItemStatus.CONFIRMED,
    WannaBuyItemStatus.CANCELLED,
    WannaBuyItemStatus.EXPIRED,
  ],
  [WannaBuyItemStatus.CONFIRMED]: [WannaBuyItemStatus.PAID, WannaBuyItemStatus.CANCELLED],
  [WannaBuyItemStatus.PAID]: [WannaBuyItemStatus.ORDERED],
  [WannaBuyItemStatus.ORDERED]: [],
  [WannaBuyItemStatus.CANCELLED]: [],
  [WannaBuyItemStatus.EXPIRED]: [],
};

export function assertTransition<T extends string>(
  transitions: Record<T, T[]>,
  current: T,
  next: T,
): void {
  if (current === next) return;
  if (!transitions[current]?.includes(next)) {
    throw new BadRequestException(`Cannot move from "${current}" to "${next}".`);
  }
}

/** Statuses that mean "not yet paid" — these items can't ride along into `PLACING_ORDERS`. */
export const UNPAID_ITEM_STATUSES: WannaBuyItemStatus[] = [
  WannaBuyItemStatus.PENDING,
  WannaBuyItemStatus.QUOTED,
  WannaBuyItemStatus.CONFIRMED,
];
