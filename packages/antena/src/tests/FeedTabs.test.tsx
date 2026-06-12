import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import FeedTabs from "../components/common/FeedTabs";

afterEach(cleanup);

describe("FeedTabs", () => {
  it("renders the 3 default tabs", () => {
    const onChange = vi.fn();
    const { getByText } = render(() => (
      <FeedTabs activeTab="home" onTabChange={onChange} />
    ));
    expect(getByText("Para vos")).toBeInTheDocument();
    expect(getByText("Siguiendo")).toBeInTheDocument();
    expect(getByText("Explorar")).toBeInTheDocument();
  });

  it("renders custom tabs when provided", () => {
    const onChange = vi.fn();
    const { getByText } = render(() => (
      <FeedTabs
        activeTab="a"
        onTabChange={onChange}
        tabs={[
          { id: "a", label: "Tab A" },
          { id: "b", label: "Tab B" },
        ]}
      />
    ));
    expect(getByText("Tab A")).toBeInTheDocument();
    expect(getByText("Tab B")).toBeInTheDocument();
  });

  it("calls onTabChange with the tab id on click", () => {
    const onChange = vi.fn();
    const { getByText } = render(() => (
      <FeedTabs activeTab="home" onTabChange={onChange} />
    ));
    fireEvent.click(getByText("Siguiendo"));
    expect(onChange).toHaveBeenCalledWith("following");

    fireEvent.click(getByText("Explorar"));
    expect(onChange).toHaveBeenCalledWith("explore");
  });

  it("shows the add tab button", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(() => (
      <FeedTabs activeTab="home" onTabChange={onChange} />
    ));
    expect(getByLabelText("Añadir pestaña")).toBeInTheDocument();
  });

  it("hides tabs when visible is false", () => {
    const onChange = vi.fn();
    const { container } = render(() => (
      <FeedTabs activeTab="home" onTabChange={onChange} visible={false} />
    ));
    const tabContainer = container.firstElementChild as HTMLElement;
    expect(tabContainer.className).toContain("-translate-y-full");
  });

  it("shows tabs when visible is true (default)", () => {
    const onChange = vi.fn();
    const { container } = render(() => (
      <FeedTabs activeTab="home" onTabChange={onChange} />
    ));
    const tabContainer = container.firstElementChild as HTMLElement;
    expect(tabContainer.className).not.toContain("-translate-y-full");
  });
});
