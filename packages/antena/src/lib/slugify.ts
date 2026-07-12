// ═══════════════════════════════════════════
// Entity slug helpers
// ═══════════════════════════════════════════
//
// We use the entity name as the URL slug on /entidad/[slug].astro
// because names are human-readable and stable in the entity graph
// (mentions are linked by name during AKIRA's regex/heuristic pass
// and only collapsed onto an id at harvest time). The slug is
// reversible — entitySlugToSearch() converts "javier-milei" back to
// "javier milei" for the /api/entities/search?q= call the Astro
// page makes at build time to resolve the slug to an entity id.

const SLUG_MAX_LEN = 80;

export function entitySlugify(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LEN);
}

export function entitySlugToSearch(slug: string): string {
  if (!slug) return "";
  return slug.replace(/-/g, " ").trim();
}