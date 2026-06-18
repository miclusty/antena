const COUNTRY_RE = /^[A-Z]{2}$/;
const UNKNOWN_VALUES = new Set(["XX", "T1"]);

export function resolveCountry(req: Request): string {
  // 1. Cookie override
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)antena_country=([A-Za-z]{2})(?:;|$)/);
  if (match) {
    const code = match[1].toUpperCase();
    if (COUNTRY_RE.test(code)) return code;
  }

  // 2. Cloudflare cf-ipcountry
  const cf = req.headers.get("cf-ipcountry")?.toUpperCase();
  if (cf && COUNTRY_RE.test(cf) && !UNKNOWN_VALUES.has(cf)) {
    return cf;
  }

  // 3. Fallback
  return "AR";
}
