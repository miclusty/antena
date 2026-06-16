// /sitemap-index.xml — Sitemap index.
//
// Lists all per-province sitemaps. Served with
// Content-Type: application/xml (Astro static output would
// default to text/html).

const SLUGS: Array<{ slug: string; name: string }> = [
  { slug: "buenos-aires", name: "Buenos Aires" },
  { slug: "ciudad-autonoma-de-buenos-aires", name: "Ciudad Autónoma de Buenos Aires" },
  { slug: "catamarca", name: "Catamarca" },
  { slug: "chaco", name: "Chaco" },
  { slug: "chubut", name: "Chubut" },
  { slug: "cordoba", name: "Córdoba" },
  { slug: "corrientes", name: "Corrientes" },
  { slug: "entre-rios", name: "Entre Ríos" },
  { slug: "formosa", name: "Formosa" },
  { slug: "jujuy", name: "Jujuy" },
  { slug: "la-pampa", name: "La Pampa" },
  { slug: "la-rioja", name: "La Rioja" },
  { slug: "mendoza", name: "Mendoza" },
  { slug: "misiones", name: "Misiones" },
  { slug: "neuquen", name: "Neuquén" },
  { slug: "rio-negro", name: "Río Negro" },
  { slug: "salta", name: "Salta" },
  { slug: "san-juan", name: "San Juan" },
  { slug: "san-luis", name: "San Luis" },
  { slug: "santa-cruz", name: "Santa Cruz" },
  { slug: "santa-fe", name: "Santa Fe" },
  { slug: "santiago-del-estero", name: "Santiago del Estero" },
  { slug: "tierra-del-fuego-antartida-e-islas-del-atlantico-sur", name: "Tierra del Fuego, Antártida e Islas del Atlántico Sur" },
  { slug: "tucuman", name: "Tucumán" },
];

export const onRequestGet = async (): Promise<Response> => {
  const now = new Date().toISOString();
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  xml += `  <sitemap><loc>https://www.antena.com.ar/sitemap.xml</loc><lastmod>${now}</lastmod></sitemap>\n`;
  for (const s of SLUGS) {
    xml += `  <sitemap><loc>https://www.antena.com.ar/sitemap-${s.slug}.xml</loc><lastmod>${now}</lastmod></sitemap>\n`;
  }
  xml += `</sitemapindex>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
