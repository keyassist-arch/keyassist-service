/** Carried in the `POST /wanna-buy` response when the item landed in a new batch because the previous one closed. */
export interface BatchRolloverInfo {
  previousBatchLabel: string;
  newBatchLabel: string;
  collectingEndsAt: string | null;
}
