import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";

vi.mock("../lib/user-country", () => ({
  country: () => "AR",
  setUserCountry: vi.fn(),
  clearUserCountry: vi.fn(),
}));

describe("CountrySelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders country list with flags", async () => {
    const { default: CountrySelector } = await import("../components/radios/CountrySelector");
    render(() => <CountrySelector onClose={() => {}} />);
    expect(screen.getByText(/Argentina/)).toBeInTheDocument();
  });

  it("filters countries by name", async () => {
    const { default: CountrySelector } = await import("../components/radios/CountrySelector");
    render(() => <CountrySelector onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/buscar/i);
    fireEvent.input(input, { target: { value: "brasil" } });
    expect(screen.getByText(/Brasil/)).toBeInTheDocument();
    expect(screen.queryByText(/Alemania/)).toBeNull();
  });

  it("calls setUserCountry on click and closes", async () => {
    const userCountry = await import("../lib/user-country");
    const onClose = vi.fn();
    const { default: CountrySelector } = await import("../components/radios/CountrySelector");
    render(() => <CountrySelector onClose={onClose} />);
    const argentina = screen.getByText(/Argentina/);
    fireEvent.click(argentina);
    expect(userCountry.setUserCountry).toHaveBeenCalledWith("AR");
    expect(onClose).toHaveBeenCalled();
  });

  it("has reset-to-detected button", async () => {
    const userCountry = await import("../lib/user-country");
    const { default: CountrySelector } = await import("../components/radios/CountrySelector");
    render(() => <CountrySelector onClose={() => {}} />);
    const reset = screen.getByText(/Restablecer/i);
    fireEvent.click(reset);
    expect(userCountry.clearUserCountry).toHaveBeenCalled();
  });
});
