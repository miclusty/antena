import { describe, it, expect } from "vitest";
import { entitySlugify, entitySlugToSearch } from "../lib/slugify";

describe("entitySlugify", () => {
  it("lowercases the input", () => {
    expect(entitySlugify("Javier Milei")).toBe("javier-milei");
  });

  it("strips diacritics", () => {
    expect(entitySlugify("Cristina Fernández")).toBe("cristina-fernandez");
    expect(entitySlugify("José")).toBe("jose");
  });

  it("collapses non-alphanumeric runs to a single dash", () => {
    expect(entitySlugify("Carlos   Raúl")).toBe("carlos-raul");
    expect(entitySlugify("a   b   c")).toBe("a-b-c");
  });

  it("strips leading and trailing dashes", () => {
    expect(entitySlugify("---hello---")).toBe("hello");
    expect(entitySlugify("...")).toBe("");
  });

  it("replaces underscores and dots with dashes", () => {
    expect(entitySlugify("Casa Rosada")).toBe("casa-rosada");
    expect(entitySlugify("U.B.A.")).toBe("u-b-a");
  });

  it("returns empty string for non-stringish input", () => {
    expect(entitySlugify("")).toBe("");
    expect(entitySlugify("   ")).toBe("");
    expect(entitySlugify("!!!")).toBe("");
  });

  it("truncates to 80 chars", () => {
    const long = "a".repeat(120);
    expect(entitySlugify(long).length).toBe(80);
  });
});

describe("entitySlugToSearch", () => {
  it("converts dashes back to spaces for the search API", () => {
    expect(entitySlugToSearch("javier-milei")).toBe("javier milei");
  });

  it("leaves an empty slug as empty", () => {
    expect(entitySlugToSearch("")).toBe("");
  });
});