import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import EntityChipRow from "../components/common/EntityChipRow";

afterEach(cleanup);

describe("EntityChipRow routing", () => {
  it("links each chip to /entidad/<slug>, not /buscar?q=", () => {
    const { container } = render(() => (
      <EntityChipRow
        heading="Personas/entidades mencionadas"
        entities={[
          { id: 1, name: "Javier Milei", type: "person", mention_count: 1247 },
          { id: 2, name: "Cristina Fernández", type: "person", mention_count: 800 },
          { id: 3, name: "Casa Rosada", type: "place", mention_count: 1200 },
        ]}
      />
    ));
    const links = Array.from(container.querySelectorAll("a"));
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/entidad/javier-milei");
    expect(hrefs).toContain("/entidad/cristina-fernandez");
    expect(hrefs).toContain("/entidad/casa-rosada");
    for (const href of hrefs) {
      expect(href).not.toMatch(/^\/buscar\?q=/);
    }
  });
});