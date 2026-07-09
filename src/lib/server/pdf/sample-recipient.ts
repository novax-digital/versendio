import "server-only";
import { buildRecipientAddressLines, toPlaceholderContext } from "@/lib/shared/address";
import type { RecipientRender } from "./render-editor";

/** A sample recipient for editor previews (before real recipients are chosen). */
export function sampleRecipient(): RecipientRender {
  const addr = {
    salutation: "Frau",
    firstName: "Erika",
    lastName: "Mustermann",
    company: "Muster GmbH",
    street: "Musterstraße 12",
    zip: "10115",
    city: "Berlin",
    country: "DE",
  };
  return {
    addressLines: buildRecipientAddressLines(addr),
    placeholders: toPlaceholderContext(addr),
  };
}
