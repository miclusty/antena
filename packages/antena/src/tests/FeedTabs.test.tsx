import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import FeedTabs from "../components/common/FeedTabs";
import type { Category } from "../lib/types";

afterEach(cleanup);

// Minimal stand-in for the app's CATEGORIES constant.
const CATEGORIES: Category[] = [
  { name: "Política", icon: "gavel", slug: "politica" },
  { name: "Economía", icon: "trending_up", slug: "economia" },
  { name: "Deportes", icon: "sports_soccer", slug: "deportes" },
];

function makeProps(overrides: Partial<Parameters<typeof FeedTabs>[0]> = {}) {
  return {
    activeTab: "home",
    onTabChange: vi.fn(),
    customTabs: [],
    onAddCustomTab: vi.fn(),
    onRemoveCustomTab: vi.fn(),
    availableCategories: CATEGORIES,
    ...overrides,
  };
}

describe("FeedTabs", () => {
  it("renders the 3 default tabs", () => {
    const props = makeProps();
    const { getByText } = render(() => <FeedTabs {...props} />);
    expect(getByText("Para vos")).toBeInTheDocument();
    expect(getByText("Siguiendo")).toBeInTheDocument();
    expect(getByText("Explorar")).toBeInTheDocument();
  });

  it("renders custom tabs when provided", () => {
    const props = makeProps({
      activeTab: "a",
      tabs: [
        { id: "a", label: "Tab A" },
        { id: "b", label: "Tab B" },
      ],
    });
    const { getByText } = render(() => <FeedTabs {...props} />);
    expect(getByText("Tab A")).toBeInTheDocument();
    expect(getByText("Tab B")).toBeInTheDocument();
  });

  it("calls onTabChange with the tab id on click", () => {
    const props = makeProps();
    const { getByText } = render(() => <FeedTabs {...props} />);
    fireEvent.click(getByText("Siguiendo"));
    expect(props.onTabChange).toHaveBeenCalledWith("following");

    fireEvent.click(getByText("Explorar"));
    expect(props.onTabChange).toHaveBeenCalledWith("explore");
  });

  it("shows the add tab button", () => {
    const props = makeProps();
    const { getByLabelText } = render(() => <FeedTabs {...props} />);
    expect(getByLabelText("Añadir pestaña")).toBeInTheDocument();
  });

  it("hides tabs when visible is false", () => {
    const props = makeProps({ visible: false });
    const { container } = render(() => <FeedTabs {...props} />);
    const tabContainer = container.firstElementChild as HTMLElement;
    expect(tabContainer.className).toContain("-translate-y-full");
  });

  it("shows tabs when visible is true (default)", () => {
    const props = makeProps();
    const { container } = render(() => <FeedTabs {...props} />);
    const tabContainer = container.firstElementChild as HTMLElement;
    expect(tabContainer.className).not.toContain("-translate-y-full");
  });

  it("opens the category picker when the add button is clicked", () => {
    const props = makeProps();
    const { getByLabelText, getByRole } = render(() => <FeedTabs {...props} />);

    // Picker is closed initially.
    expect(props.onAddCustomTab).not.toHaveBeenCalled();

    fireEvent.click(getByLabelText("Añadir pestaña"));
    // Picker opens: the listbox becomes visible and lists each
    // available category.
    const listbox = getByRole("listbox");
    expect(listbox).toBeInTheDocument();
  });

  it("calls onAddCustomTab when a category is picked", () => {
    const props = makeProps();
    const { getByLabelText, getByText, getByRole } = render(() => <FeedTabs {...props} />);

    fireEvent.click(getByLabelText("Añadir pestaña"));
    fireEvent.click(getByText("Política"));

    expect(props.onAddCustomTab).toHaveBeenCalledWith(CATEGORIES[0]);
  });

  it("renders a remove button for each custom tab", () => {
    const props = makeProps({
      customTabs: [
        { id: "cat:politica", label: "Política", category: "politica" },
        { id: "cat:deportes", label: "Deportes", category: "deportes" },
      ],
    });
    const { getByLabelText } = render(() => <FeedTabs {...props} />);
    expect(getByLabelText("Quitar pestaña Política")).toBeInTheDocument();
    expect(getByLabelText("Quitar pestaña Deportes")).toBeInTheDocument();
  });

  it("calls onRemoveCustomTab when the remove button is clicked", () => {
    const props = makeProps({
      customTabs: [
        { id: "cat:politica", label: "Política", category: "politica" },
      ],
    });
    const { getByLabelText } = render(() => <FeedTabs {...props} />);

    fireEvent.click(getByLabelText("Quitar pestaña Política"));
    expect(props.onRemoveCustomTab).toHaveBeenCalledWith("cat:politica");
  });

  it("does not show already-added categories in the picker", () => {
    const props = makeProps({
      customTabs: [
        { id: "cat:politica", label: "Política", category: "politica" },
      ],
    });
    const { getByLabelText, getByRole, queryAllByRole } = render(() => <FeedTabs {...props} />);

    fireEvent.click(getByLabelText("Añadir pestaña"));
    // Picker is now open.
    expect(getByRole("listbox")).toBeInTheDocument();

    // Política was already added as a tab — it must not appear
    // inside the picker's listbox.
    const options = queryAllByRole("option");
    // The option text is the category icon + name (e.g.
    // "trending_upEconomía"). Strip the icon prefix to compare.
    const labels = options.map((o) => o.textContent?.trim() ?? "");
    expect(labels).not.toContain("Política");
    // Strip the icon to compare against the bare category name.
    const names = labels.map((l) => l.replace(/^[a-z_]+/, ""));
    expect(names).toContain("Economía");
    expect(names).toContain("Deportes");
  });
});
