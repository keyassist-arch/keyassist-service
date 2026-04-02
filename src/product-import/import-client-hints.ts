import { ImportStatus } from '../common/enums/import-status.enum';

/** Suggested interval for `GET /products/import/:importId` while waiting */
export const IMPORT_POLL_AFTER_MS = 2_500;

/**
 * Rough range for Playwright-based imports (slow retail sites, retries).
 * Not a deadline — only for UI copy (“usually 30s–3 min”).
 */
export const IMPORT_TYPICAL_WAIT_SECONDS = { min: 30, max: 180 } as const;

export type ImportPhase = 'queued' | 'scraping';

/** Why `phase === 'queued'` — drives user-facing copy */
export type QueuedHintTone = 'newJob' | 'waiting' | 'rescrape';

export type ImportPendingClientHints = {
  phase: ImportPhase;
  /** Safe to show under a spinner */
  userMessage: string;
  /** Poll import status after this many ms */
  pollAfterMs: number;
  typicalWaitSeconds: { min: number; max: number };
};

export function importPhaseFromStatus(
  status: ImportStatus,
): ImportPhase | null {
  if (status === ImportStatus.QUEUED) {
    return 'queued';
  }
  if (status === ImportStatus.PROCESSING) {
    return 'scraping';
  }
  return null;
}

export function pendingImportHints(
  phase: ImportPhase,
  queuedTone: QueuedHintTone = 'waiting',
): ImportPendingClientHints {
  const base = {
    pollAfterMs: IMPORT_POLL_AFTER_MS,
    typicalWaitSeconds: {
      min: IMPORT_TYPICAL_WAIT_SECONDS.min,
      max: IMPORT_TYPICAL_WAIT_SECONDS.max,
    },
  };
  if (phase === 'queued') {
    const userMessage =
      queuedTone === 'newJob'
        ? 'Your import was added to the background queue. A worker will open the product page and extract details next — keep this screen open; it will update automatically.'
        : queuedTone === 'rescrape'
          ? 'Re-fetching this product from the store to update price, images, and details. Stay on this screen; it will refresh when the new scrape finishes.'
          : 'This import is still waiting to start or you opened the same link twice — both use one shared job. Stay here while the queue runs; no need to submit again.';
    return {
      ...base,
      phase,
      userMessage,
    };
  }
  return {
    ...base,
    phase,
    userMessage:
      'We are opening the store page in a real browser to read title, price, and images. ' +
      'Most imports finish within a couple of minutes; large or slow sites can take longer.',
  };
}
