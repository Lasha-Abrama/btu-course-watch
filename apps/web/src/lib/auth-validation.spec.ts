import { describe, expect, it } from "vitest";
import {
  normalizeBtuEmail,
  passwordHint,
  takeEmailToken,
} from "./auth-validation";

describe("auth form helpers", () => {
  it("normalizes only exact BTU addresses and checks the shared password policy", () => {
    expect(normalizeBtuEmail(" Student@BTU.EDU.GE ")).toBe(
      "student@btu.edu.ge",
    );
    expect(normalizeBtuEmail("student@sub.btu.edu.ge")).toBeNull();
    expect(normalizeBtuEmail("student@btu.edu.ge.evil")).toBeNull();
    expect(passwordHint("A sufficiently strong passphrase 42")).toBeNull();
    expect(passwordHint("password123")).not.toBeNull();
  });

  it("takes a one-time link fragment and immediately clears it from history", () => {
    const replace = (url: string) => {
      expect(url).toBe("/reset-password");
    };
    const token = "A".repeat(43);
    expect(
      takeEmailToken(
        { hash: `#token=${token}`, pathname: "/reset-password", search: "" },
        replace,
      ),
    ).toBe(token);
    expect(
      takeEmailToken(
        { hash: "#token=invalid", pathname: "/reset-password", search: "" },
        replace,
      ),
    ).toBeNull();
  });
});
