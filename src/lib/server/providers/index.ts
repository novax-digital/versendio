import "server-only";
import { isMockMode } from "@/lib/server/env";
import type { LetterProvider } from "./types";
import { MockProvider } from "./mock";
import { EpostProvider } from "./epost";

let mockInstance: MockProvider | null = null;
let epostInstance: EpostProvider | null = null;

/**
 * Provider selection (ADR-0005 §2): MockProvider when MOCK_MODE=true or the
 * E-Post configuration is incomplete; EpostProvider otherwise. The effective
 * mode is surfaced as a badge in the UI and on the admin status page.
 */
export function getLetterProvider(): LetterProvider {
  if (isMockMode()) {
    mockInstance ??= new MockProvider();
    return mockInstance;
  }
  epostInstance ??= new EpostProvider();
  return epostInstance;
}
