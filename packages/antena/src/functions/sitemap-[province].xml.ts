// /sitemap-:province.xml — Per-province sitemap proxy.
//
// Maps province slug → province name and proxies to the
// API endpoint, returning Content-Type: application/xml.

const SLUG_TO_PROVINCE: Record<string, string> = {
  "buenos-aires": "Buenos Aires",
  "ciudad-autonoma-de-buenos-aires": "Ciudad Autónoma de Buenos Aires",
  "catamarca": "Catamarca",
  "chaco": "Chaco",
  "chubut": "Chubut",
  "cordoba": "Córdoba",
  "corrientes": "Corrientes",
  "entre-rios": "Entre Ríos",
  "formosa": "Formosa",
  "jujuy": "Jujuy",
  "la-pampa": "La Pampa",
  "la-rioja": "La Rioja",
  "mendoza": "Mendoza",
  "misiones": "Misiones",
  "neuquen": "Neuquén",
  "rio-negro": "Río Negro",
  "salta": "Salta",
  "san-juan": "San Juan",
  "san-luis": "San Luis",
  "santa-cruz": "Santa Cruz",
  "santa-fe": "Santa Fe",
  "santiago-del-estero": "Santiago del Estero",
  "tierra-del-fuego-antartida-e-islas-del-atlantico-sur": "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
  "tucuman": "Tucumán",
};

interface PagesContextLite {
  request: Request;
  env: { API_BASE?: string };
  params: { province: string };
}

export const onRequestGet = async (ctx: PagesContextLite): Promise<Response> => {
  const province = SLUG_TO_PROVINCE[ctx.params.province];
  if (!province) {
    return new Response("Unknown province", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  }
  const apiBase = ctx.env.API_BASE || "https://akira-api.miclusty.workers.dev";
  try {
    const res = await fetch(`${apiBase}/api/sitemap-province/${encodeURIComponent(province)}`);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return new Response(`<error>${(e as Error).message}</error>`, {
      status: 502,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }
};
