import "server-only";

/**
 * Storage path of the user's stored signed AVV (private assets bucket, own
 * prefix — wiped with the account by the GDPR prefix cleanup).
 */
export function avvStoragePath(userId: string): string {
  return `${userId}/avv/AVV_Versendio_unterzeichnet.pdf`;
}
