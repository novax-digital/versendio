import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
});

describe("escapeHtml (transactional mail safety)", () => {
  it("escapes the characters that could inject markup", async () => {
    const { escapeHtml } = await import("@/lib/server/mail");
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeHtml("Tom & Jerry's")).toBe("Tom &amp; Jerry&#39;s");
  });

  it("escapes ampersands before other entities (no double-escaping)", async () => {
    const { escapeHtml } = await import("@/lib/server/mail");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary German names untouched", async () => {
    const { escapeHtml } = await import("@/lib/server/mail");
    expect(escapeHtml("Jörg Müller-Straßburg")).toBe("Jörg Müller-Straßburg");
  });
});
