import { createSignal } from "solid-js";
import { getApiBase } from "./api";

const LS_KEY = "antena.radio.country";
const COOKIE = "antena_country";
const COUNTRY_RE = /^[A-Z]{2}$/;

const [country, setCountry] = createSignal<string>("AR");
const [detectedCountry, setDetected] = createSignal<string | null>(null);
const [isOverride, setIsOverride] = createSignal(false);

export async function loadUserCountry(): Promise<string> {
  const ls = typeof localStorage !== "undefined"
    ? localStorage.getItem(LS_KEY)
    : null;
  if (ls && COUNTRY_RE.test(ls)) {
    setCountry(ls);
    setIsOverride(true);
    return ls;
  }

  try {
    const r = await fetch(`${getApiBase()}/api/stats/radios/countries`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const detected = data.detected ?? "AR";
    setDetected(detected);
    const effective = data.override ?? detected ?? "AR";
    setCountry(effective);
    setIsOverride(Boolean(data.override));
    return effective;
  } catch {
    return country();
  }
}

export function setUserCountry(code: string): void {
  if (!COUNTRY_RE.test(code)) return;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LS_KEY, code);
  }
  document.cookie = `${COOKIE}=${code}; path=/; max-age=86400; SameSite=Lax`;
  setCountry(code);
  setIsOverride(true);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("antena:country-changed", { detail: { country: code } }));
  }
}

export function clearUserCountry(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(LS_KEY);
  }
  document.cookie = `${COOKIE}=; path=/; max-age=0`;
  setIsOverride(false);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("antena:country-changed", { detail: { country: detectedCountry() ?? "AR" } }));
  }
}

export { country, detectedCountry, isOverride };
