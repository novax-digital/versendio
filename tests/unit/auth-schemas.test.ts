import { describe, expect, it } from "vitest";
import { changePasswordSchema, loginSchema, registerSchema } from "@/lib/shared/schemas/auth";
import { profileSchema, senderAddressSchema } from "@/lib/shared/schemas/profile";

describe("loginSchema", () => {
  it("normalizes the email", () => {
    const result = loginSchema.parse({ email: "  User@Example.COM ", password: "x" });
    expect(result.email).toBe("user@example.com");
  });

  it("rejects invalid emails", () => {
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
  });
});

describe("registerSchema", () => {
  const base = {
    email: "user@example.com",
    displayName: "Max",
    company: "",
    password: "supersecret",
    passwordConfirm: "supersecret",
  };

  it("accepts a valid registration", () => {
    expect(registerSchema.safeParse(base).success).toBe(true);
  });

  it("rejects mismatched passwords", () => {
    const result = registerSchema.safeParse({ ...base, passwordConfirm: "different" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["passwordConfirm"]);
    }
  });

  it("rejects short passwords", () => {
    expect(
      registerSchema.safeParse({ ...base, password: "short", passwordConfirm: "short" }).success,
    ).toBe(false);
  });
});

describe("senderAddressSchema", () => {
  const base = {
    label: "Hauptsitz",
    company: "Muster GmbH",
    firstName: "",
    lastName: "",
    street: "Musterstraße 1",
    zip: "10115",
    city: "Berlin",
    country: "DE",
    senderLine: "Muster GmbH · Musterstraße 1 · 10115 Berlin",
    isDefault: true,
  };

  it("accepts a valid address", () => {
    expect(senderAddressSchema.safeParse(base).success).toBe(true);
  });

  it("validates the zip against the country", () => {
    const result = senderAddressSchema.safeParse({ ...base, zip: "123" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "zip")).toBe(true);
    }
  });

  it("requires company or last name", () => {
    const result = senderAddressSchema.safeParse({ ...base, company: "", lastName: "" });
    expect(result.success).toBe(false);
  });

  it("normalizes lowercase country codes", () => {
    const result = senderAddressSchema.parse({ ...base, country: "de" });
    expect(result.country).toBe("DE");
  });

  it("defaults an empty country to DE", () => {
    const result = senderAddressSchema.parse({ ...base, country: "" });
    expect(result.country).toBe("DE");
  });
});

describe("profileSchema", () => {
  it("defaults an empty billing country to DE", () => {
    const result = profileSchema.parse({ displayName: "Max", billingCountry: "" });
    expect(result.billingCountry).toBe("DE");
  });
});

describe("changePasswordSchema", () => {
  const base = {
    currentPassword: "old-password",
    password: "new-password-123",
    passwordConfirm: "new-password-123",
  };

  it("accepts a valid change", () => {
    expect(changePasswordSchema.safeParse(base).success).toBe(true);
  });

  it("requires the current password", () => {
    expect(changePasswordSchema.safeParse({ ...base, currentPassword: "" }).success).toBe(false);
  });

  it("rejects a mismatched confirmation", () => {
    expect(changePasswordSchema.safeParse({ ...base, passwordConfirm: "other" }).success).toBe(
      false,
    );
  });
});
