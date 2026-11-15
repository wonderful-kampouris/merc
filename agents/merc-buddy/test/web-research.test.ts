// research_store: Firecrawl path when the secret exists, keyless fallback otherwise, never maps/review sites.
import { describe, expect, it } from "vitest";
import { blockedReason, parseDdg, researchStore, type FetchLike } from "../lib/web-research";

const res = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => String(body), json: async () => body });
const DDG_HTML = `
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.tripadvisor.com%2FX&amp;rut=1">TA</a><a class="result__snippet" href="#">reviews</a>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcafetaf.gr%2F&amp;rut=2">Taf <b>Coffee</b></a><a class="result__snippet" href="#">Specialty &amp; roastery</a>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsendme.coffee%2Ftaf&amp;rut=3">Shop</a><a class="result__snippet" href="#">Blends</a>`;
const PAGE = `<html><head><title>x</title></head><body><h1>Taf Coffee</h1><p>${"Espresso blends, single estate, Danesi Caffè. ".repeat(10)}</p><script>bad()</script></body></html>`;

function fakeFetch(routes: Record<string, (init?: any) => ReturnType<typeof res>>) {
  const calls: Array<{ url: string; init?: any }> = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const k = Object.keys(routes).find((p) => url.startsWith(p));
    return k ? routes[k]!(init) : res("", 404);
  };
  return { f, calls };
}

describe("research_store", () => {
  it("blocks maps, review/delivery platforms and seed placeholder sites", () => {
    expect(blockedReason("https://www.google.com/maps/place/x")).toBeTruthy();
    expect(blockedReason("https://www.tripadvisor.com/Restaurant_Review")).toBeTruthy();
    expect(blockedReason("https://www.e-food.gr/delivery/x")).toBeTruthy();
    expect(blockedReason("https://miltos.example.gr")).toBe("placeholder site");
    expect(blockedReason("https://cafetaf.gr/")).toBeNull();
  });

  it("parses DuckDuckGo results and unwraps redirect links", () => {
    const r = parseDdg(DDG_HTML);
    expect(r.map((x) => x.url)).toEqual(["https://www.tripadvisor.com/X", "https://cafetaf.gr/", "https://sendme.coffee/taf"]);
    expect(r[1]).toMatchObject({ title: "Taf Coffee", snippet: "Specialty & roastery" });
  });

  it("keyless: searches the web, drops blocked sources, skips a 403 site and reads the next page", async () => {
    const { f, calls } = fakeFetch({
      "https://html.duckduckgo.com/html/": () => res(DDG_HTML),
      "https://cafetaf.gr/": () => res("forbidden", 403),
      "https://sendme.coffee/taf": () => res(PAGE),
    });
    const r: any = await researchStore({ fetch: f, secrets: null }, { query: "Taf Coffee Athens", website: "https://taf.example.gr" });
    expect(r.via).toBe("web");
    expect(r.sources.map((s: any) => s.url)).toEqual(["https://cafetaf.gr/", "https://sendme.coffee/taf"]);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0].url).toBe("https://sendme.coffee/taf");
    expect(r.pages[0].content).toContain("Danesi Caffè");
    expect(r.pages[0].content).not.toContain("bad()");
    expect(calls.some((c) => c.url.includes("taf.example.gr"))).toBe(false); // placeholder seed site never fetched
    expect(calls.some((c) => c.url.includes("tripadvisor"))).toBe(false);
  });

  it("with FIRECRAWL_API_KEY: uses Firecrawl search markdown through the platform secret", async () => {
    const { f, calls } = fakeFetch({
      "https://api.firecrawl.dev/v1/search": () => res({ success: true, data: [
        { url: "https://www.yelp.com/biz/taf", title: "Yelp", description: "r", markdown: "reviews" },
        { url: "https://cafetaf.gr/en/", title: "TAF", description: "Coffee roasters since 1989", markdown: "# TAF\n" + "Taloumis Family Limited Reserve. ".repeat(10) },
      ] }),
    });
    const r: any = await researchStore({ fetch: f, secrets: { get: (n) => (n === "FIRECRAWL_API_KEY" ? "fc-x" : null) } }, { query: "TAF Coffee Athens" });
    expect(r.via).toBe("firecrawl");
    expect(r.sources.map((s: any) => s.url)).toEqual(["https://cafetaf.gr/en/"]);
    expect(r.pages[0].content).toContain("Taloumis");
    expect(calls[0]!.init.secretName).toBe("FIRECRAWL_API_KEY");
    expect(calls.some((c) => c.url.includes("duckduckgo"))).toBe(false);
  });

  it("falls back to the keyless search when Firecrawl fails", async () => {
    const { f } = fakeFetch({
      "https://api.firecrawl.dev/": () => res({ error: "quota" }, 402),
      "https://html.duckduckgo.com/html/": () => res(DDG_HTML),
      "https://cafetaf.gr/": () => res(PAGE),
    });
    const r: any = await researchStore({ fetch: f, secrets: { get: () => "fc-x" } }, { query: "Taf Coffee" });
    expect(r.sources.length).toBe(2);
    expect(r.pages[0].url).toBe("https://cafetaf.gr/");
  });

  it("asks for a name when given nothing, not_found when the web has nothing", async () => {
    const { f } = fakeFetch({ "https://html.duckduckgo.com/html/": () => res("<html></html>") });
    expect(((await researchStore({ fetch: f }, {})) as any).error.code).toBe("invalid");
    expect(((await researchStore({ fetch: f }, { query: "zzzz qqqq" })) as any).error.code).toBe("not_found");
  });
});
