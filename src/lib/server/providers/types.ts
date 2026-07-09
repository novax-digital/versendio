import "server-only";

/**
 * Provider-neutral letter dispatch contract (ADR-0005). E-Post specifics
 * (status ids, error codes) are mapped inside the adapter; the domain only
 * sees these types. Additional carriers implement this same interface.
 */

export type ProviderItemStatus =
  | "accepted" // E-Post 1 — Annahme
  | "checked" // E-Post 2 — geprüft
  | "print_center" // E-Post 3 — im Druckzentrum
  | "sent" // E-Post 4 — produziert/versendet (billed)
  | "failed"; // E-Post 99 — final error

export type SubmitLetterInput = {
  /** Our send_job_item id; round-trips via custom1 for reconciliation. */
  itemId: string;
  /** Unique file name, 5-200 chars, no special characters. */
  fileName: string;
  pdfBytes: Uint8Array;
  isColor: boolean;
  isDuplex: boolean;
  registered: "none" | "einwurf" | "einschreiben" | "rueckschein";
  /** Printed address lines (1-5 used for metadata match). */
  addressLines: string[];
  zipCode: string;
  city: string;
  /** ISO 3166-1 alpha-2; adapter converts/omits per provider rules. */
  country: string;
  senderLine: string;
  /** int32 group id for batch status queries. */
  providerBatchId: number;
  costCenter: string;
  isTest: boolean;
  testShowRestrictedArea?: boolean;
};

export type SubmitLetterResult = {
  providerLetterId: string;
};

export type ProviderStatusInfo = {
  providerLetterId: string;
  status: ProviderItemStatus;
  providerStatusId: number;
  details: string | null;
  frankierId: string | null;
  /** BZE tracking ("arrived in destination area"), when reported. */
  destinationAreaStatus: string | null;
  destinationAreaStatusDate: string | null;
  registeredStatus: string | null;
  custom1: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly options: {
      /** Transient errors are retried with backoff; permanent ones fail+refund. */
      retryable: boolean;
      providerCode?: string;
      /** E324 duplicate: treat the previous attempt as successful. */
      duplicate?: boolean;
    },
  ) {
    super(message);
  }
}

export interface LetterProvider {
  readonly name: "mock" | "epost";
  submitLetter(input: SubmitLetterInput): Promise<SubmitLetterResult>;
  getStatus(providerLetterId: string): Promise<ProviderStatusInfo | null>;
  /** Bulk status for open (non-final) letters — the throttled polling path. */
  listOpenLetters(): Promise<ProviderStatusInfo[]>;
  /** Reconciliation lookup after a crash between POST and DB write. */
  findByItemId(itemId: string): Promise<ProviderStatusInfo | null>;
  /** Test-run result PDF (available ~48h). */
  getTestResult(providerLetterId: string): Promise<Uint8Array | null>;
  cancelQueued(providerLetterId: string): Promise<boolean>;
  releaseQueued(providerLetterId: string): Promise<boolean>;
  healthCheck(): Promise<{ ok: boolean; message: string | null }>;
}
