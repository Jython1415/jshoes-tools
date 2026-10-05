// Link previews for /margin/?h=…&url=…
// Crawlers (Bluesky, Slack, iMessage) do not run the page's JavaScript, so the
// preview tags are written into the HTML here, from the same public records
// the page reads. Any failure or slow upstream serves the plain page.
import { resolveActor, recordsFor, profile, pageInfo, normUrl, cached } from "../_lib/margin.js";

const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };

async function previewFor(context, h, url) {
  const { request } = context;
  const actor = await cached(request, context, `/__c/actor/${encodeURIComponent(h.toLowerCase())}`, 3600, () => resolveActor(h));
  const [recs, prof] = await Promise.all([
    cached(request, context, `/__c/recs/${actor.did}/${encodeURIComponent(normUrl(url))}`, 60, () => recordsFor(actor, url)),
    cached(request, context, `/__c/prof/${actor.did}`, 3600, () => profile(actor.did)),
  ]);
  if (!recs.length) return null;
  const page = await cached(request, context, `/__c/page/${encodeURIComponent(normUrl(url))}`, 21600, () => pageInfo(recs[0].source)).catch(() => ({}));
  const handle = actor.handle || (prof && prof.handle) || actor.did;
  const name = (prof && prof.displayName) || "@" + handle;
  const title = (page.doc && page.doc.title) || recs.find((r) => r.title)?.title || page.title || url.replace(/^https?:\/\//, "");
  const notes = recs.filter((r) => r.kind === "note").length, hls = recs.length - notes;
  const first = recs.find((r) => r.kind === "note" && r.exact) || recs.find((r) => r.exact) || recs[0];
  const counts = [notes && `${notes} annotation${notes === 1 ? "" : "s"}`, hls && `${hls} highlight${hls === 1 ? "" : "s"}`].filter(Boolean).join(", ");
  const desc = first ? clip(`${counts}. “${clip(first.exact, 160)}”${first.body ? " — " + clip(first.body, 80) : ""}`, 280) : counts;
  return {
    title: clip(`${name}’s notes on ${title}`, 140),
    description: desc,
    image: page.image || (prof && prof.avatar) || null,
    large: !!page.image,
    site: "Margin notes",
  };
}

class Head {
  constructor(p, pageUrl) { this.p = p; this.u = pageUrl; }
  element(el) {
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const m = (k, v, a = "property") => v ? `<meta ${a}="${k}" content="${esc(v)}">\n` : "";
    el.append(
      m("og:type", "article") + m("og:site_name", this.p.site) + m("og:url", this.u) +
      m("og:title", this.p.title) + m("og:description", this.p.description) + m("og:image", this.p.image) +
      m("twitter:card", this.p.large ? "summary_large_image" : "summary", "name") +
      m("twitter:title", this.p.title, "name") + m("twitter:description", this.p.description, "name") + m("twitter:image", this.p.image, "name") +
      m("description", this.p.description, "name"),
      { html: true });
  }
}
class Title { constructor(t) { this.t = t; } element(el) { el.setInnerContent(this.t); } }

export async function onRequest(context) {
  const { request, next } = context;
  const u = new URL(request.url);
  const res = await next();
  if (request.method !== "GET" || !/^\/margin\/(index\.html)?$/.test(u.pathname)) return res;
  if (!/text\/html/.test(res.headers.get("content-type") || "")) return res;
  const h = u.searchParams.get("h") || u.searchParams.get("handle"), url = u.searchParams.get("url");
  if (!h || !url) return res;
  let p = null;
  try {
    p = await Promise.race([previewFor(context, h, url), new Promise((r) => setTimeout(() => r(null), 3500))]);
  } catch {}
  if (!p) return res;
  return new HTMLRewriter().on("head", new Head(p, u.toString())).on("title", new Title(p.title)).transform(res);
}
