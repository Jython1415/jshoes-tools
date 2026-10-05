// GET /margin/api/page?h=<handle|did>&url=<page>
// The article text (and its source) so the page can put notes in reading
// order. The page is fetched only when that person has Margin records on it,
// which keeps this from being a general-purpose fetcher.
import { resolveActor, recordsFor, pageInfo, normUrl, cached } from "../../_lib/margin.js";

const json = (body, status = 200, maxAge = 300) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${maxAge}`, "access-control-allow-origin": "*" },
});

export async function onRequestGet(context) {
  const { request } = context;
  const q = new URL(request.url).searchParams;
  const h = (q.get("h") || "").trim(), url = (q.get("url") || "").trim();
  if (!h || !/^https?:\/\//i.test(url)) return json({ error: "h and an http(s) url are required" }, 400, 0);
  try {
    const actor = await cached(request, context, `/__c/actor/${encodeURIComponent(h.toLowerCase())}`, 3600, () => resolveActor(h));
    const recs = await cached(request, context, `/__c/recs/${actor.did}/${encodeURIComponent(normUrl(url))}`, 60, () => recordsFor(actor, url));
    if (!recs.length) return json({ error: "no Margin records for this page" }, 404, 60);
    const page = await cached(request, context, `/__c/page/${encodeURIComponent(normUrl(url))}`, 21600, () => pageInfo(recs[0].source));
    return json({ url: page.url, title: page.title, doc: page.doc, textSource: page.textSource, text: page.text });
  } catch (e) {
    return json({ error: String(e.message || e) }, 502, 0);
  }
}
