import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import FollowButton from "../components/common/FollowButton";
import { __resetFollowsForTests } from "../lib/follows";

afterEach(() => {
  cleanup();
  __resetFollowsForTests();
});

describe("FollowButton", () => {
  beforeEach(() => {
    // Reset the shared follows state and the persisted localStorage.
    __resetFollowsForTests();
    if (typeof localStorage !== "undefined") localStorage.clear();
    // Default fetch mock: no follows yet, follow/unfollow succeed.
    globalThis.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET" && url.includes("/api/me/follows")) {
        return { ok: true, status: 200, json: async () => ({ follows: [] }) };
      }
      if (method === "POST" || method === "DELETE") {
        return { ok: true, status: 200, json: async () => ({ following: method === "POST" }) };
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
  });

  it("renders 'Seguir' when not following", async () => {
    const { findByLabelText } = render(() => <FollowButton sourceId={42} />);
    const btn = await findByLabelText("Seguir");
    expect(btn).toBeInTheDocument();
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles to 'Siguiendo' on click", async () => {
    const { findByLabelText } = render(() => <FollowButton sourceId={42} />);
    const btn = await findByLabelText("Seguir");
    fireEvent.click(btn);
    // The async follow + state update need a microtask + DOM update.
    // Wait up to 500ms with polling.
    const following = await findByLabelText("Siguiendo", {}, { timeout: 1000 });
    expect(following).toBeInTheDocument();
    expect(following.getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles back to 'Seguir' on second click", async () => {
    const { findByLabelText } = render(() => <FollowButton sourceId={42} />);
    fireEvent.click(await findByLabelText("Seguir"));
    fireEvent.click(await findByLabelText("Siguiendo"));
    const back = await findByLabelText("Seguir");
    expect(back).toBeInTheDocument();
  });

  it("calls onFollowed callback on follow", async () => {
    const onFollowed = vi.fn();
    const { findByLabelText } = render(() => (
      <FollowButton sourceId={42} onFollowed={onFollowed} />
    ));
    const btn = await findByLabelText("Seguir");
    fireEvent.click(btn);
    // Wait for the state to update (the async follow + DOM rerender).
    await findByLabelText("Siguiendo");
    expect(onFollowed).toHaveBeenCalledWith(42);
  });

  it("calls onUnfollowed callback on unfollow", async () => {
    const onUnfollowed = vi.fn();
    const { findByLabelText } = render(() => (
      <FollowButton sourceId={42} onUnfollowed={onUnfollowed} />
    ));
    fireEvent.click(await findByLabelText("Seguir"));
    fireEvent.click(await findByLabelText("Siguiendo"));
    await new Promise((r) => setTimeout(r, 10));
    expect(onUnfollowed).toHaveBeenCalledWith(42);
  });

  it("stops click propagation so parent cards don't navigate", async () => {
    let parentClicked = false;
    const { findByLabelText, getByTestId } = render(() => (
      <div onClick={() => { parentClicked = true; }} data-testid="parent">
        <FollowButton sourceId={42} />
      </div>
    ));
    const btn = await findByLabelText("Seguir");
    fireEvent.click(btn);
    expect(parentClicked).toBe(false);
    // The parent div is still in the DOM.
    expect(getByTestId("parent")).toBeInTheDocument();
  });

  it("renders 'sm' size without the text label", async () => {
    const { findByLabelText } = render(() => <FollowButton sourceId={1} size="sm" />);
    const btn = await findByLabelText("Seguir");
    // The "sm" size hides the "Seguir"/"Siguiendo" text label
    // (only the icon is visible). The icon glyph is in a <span>
    // so textContent may include it, but the visible text label
    // is absent.
    const textSpan = Array.from(btn.querySelectorAll("span")).find(
      (s) => s.textContent === "Seguir" || s.textContent === "Siguiendo",
    );
    expect(textSpan).toBeUndefined();
  });

  it("renders 'md' size with text label", async () => {
    const { findByLabelText } = render(() => <FollowButton sourceId={1} size="md" />);
    const btn = await findByLabelText("Seguir");
    expect(btn.textContent).toContain("Seguir");
  });
});
