import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import Header from "../components/layout/Header";

afterEach(cleanup);

describe("Header", () => {
  it("reserves the iOS safe-area top inset", () => {
    const { container } = render(() => <Header />);
    const header = container.querySelector("header");
    expect(header?.getAttribute("style") ?? "").toContain("env(safe-area-inset-top, 0px)");
  });
});
