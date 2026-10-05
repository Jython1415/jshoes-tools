// GET /margin/card?h=<handle|did>&url=<page>&v=<version>
// The 1200x630 share image ("note stack"). `v` changes whenever the person's
// notes on the page change, so platforms that cache images by URL refetch.
import yoga from "../_vendor/yoga.wasm";
import resvg from "../_vendor/resvg.wasm";
import { resolveActor, recordsFor, profile, pageInfo, normUrl, cached } from "../_lib/margin.js";
import { renderCard, inPageOrder, titleFor } from "../_lib/card.js";

export async function onRequestGet(context) {
  const { request } = context;
  const cache = caches.default;
  const hit = await cache.match(request).catch(() => null);
  if (hit) return hit;
  const q = new URL(request.url).searchParams;
  const h = (q.get("h") || "").trim(), url = (q.get("url") || "").trim();
  if (!h || !/^https?:\/\//i.test(url)) return new Response("h and an http(s) url are required", { status: 400 });
  let prof = null;
  try {
    const actor = await cached(request, context, `/__c/actor/${encodeURIComponent(h.toLowerCase())}`, 3600, () => resolveActor(h));
    const [recs, p] = await Promise.all([
      cached(request, context, `/__c/recs/${actor.did}/${encodeURIComponent(normUrl(url))}`, 60, () => recordsFor(actor, url)),
      cached(request, context, `/__c/prof/${actor.did}`, 3600, () => profile(actor.did)),
    ]);
    prof = p;
    if (!recs.length) return new Response("no Margin records for this page", { status: 404 });
    const page = await cached(request, context, `/__c/page/${encodeURIComponent(normUrl(url))}`, 21600, () => pageInfo(recs[0].source)).catch(() => ({}));
    const name = (prof && prof.displayName) || "@" + (actor.handle || actor.did);
    let host = ""; try { host = new URL(recs[0].source).hostname.replace(/^www\./, ""); } catch {}
    const png = await renderCard({
      title: titleFor(recs, page, recs[0].source),
      subtitle: `${name}’s notes · ${host}`,
      avatarUrl: prof && prof.avatar,
      notes: inPageOrder(recs, page.text),
    }, { yoga, resvg });
    const res = new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    context.waitUntil(cache.put(request, res.clone()).catch(() => {}));
    return res;
  } catch (e) {
    // A preview with the person's avatar beats a broken image.
    if (prof && prof.avatar) return Response.redirect(prof.avatar.replace(/@\w+$/, "") + "@jpeg", 302);
    return new Response("could not render: " + String(e && e.message || e), { status: 502 });
  }
}
