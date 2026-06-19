import { describe, it, expect } from 'vitest';
import { resolveCountry } from '../src/lib/country';

describe("resolveCountry", () => {
  const makeReq = (headers: Record<string, string>, cookies: Record<string, string> = {}) => {
    const cookieStr = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    const headerObj: Record<string, string> = { ...headers };
    if (cookieStr) headerObj["cookie"] = cookieStr;
    return new Request("https://api.example.com/api/stats/radios", {
      headers: headerObj,
    });
  };

  it("uses cookie override over cf-ipcountry", () => {
    const req = makeReq({ "cf-ipcountry": "BR" }, { antena_country: "CL" });
    expect(resolveCountry(req)).toBe("CL");
  });

  it("uses cf-ipcountry when no cookie override", () => {
    const req = makeReq({ "cf-ipcountry": "BR" });
    expect(resolveCountry(req)).toBe("BR");
  });

  it("falls back to AR when cf-ipcountry is XX", () => {
    const req = makeReq({ "cf-ipcountry": "XX" });
    expect(resolveCountry(req)).toBe("AR");
  });

  it("falls back to AR when cf-ipcountry is T1", () => {
    const req = makeReq({ "cf-ipcountry": "T1" });
    expect(resolveCountry(req)).toBe("AR");
  });

  it("falls back to AR when cf-ipcountry is missing", () => {
    const req = makeReq({});
    expect(resolveCountry(req)).toBe("AR");
  });

  it("uppercases lowercase values", () => {
    const req = makeReq({ "cf-ipcountry": "br" });
    expect(resolveCountry(req)).toBe("BR");
  });

  it("ignores malformed cookie", () => {
    const req = makeReq({ "cf-ipcountry": "AR" }, { antena_country: "invalid123" });
    expect(resolveCountry(req)).toBe("AR");
  });
});
