import "server-only";
import { buildRecipientAddressLines, toPlaceholderContext } from "@/lib/shared/address";
import type { RecipientRender } from "./render-editor";

/** Placeholder address for previews that must not carry real recipient data. */
export const SAMPLE_RECIPIENT_ADDRESS = {
  salutation: "Frau",
  firstName: "Erika",
  lastName: "Mustermann",
  company: "Muster GmbH",
  street: "Musterstraße 12",
  zip: "10115",
  city: "Berlin",
  country: "DE",
};

/** A sample recipient for editor previews (before real recipients are chosen). */
export function sampleRecipient(): RecipientRender {
  return {
    addressLines: buildRecipientAddressLines(SAMPLE_RECIPIENT_ADDRESS),
    placeholders: toPlaceholderContext(SAMPLE_RECIPIENT_ADDRESS),
  };
}
