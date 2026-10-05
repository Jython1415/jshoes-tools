// Shared server-side helpers for /margin/ (Cloudflare Pages Functions).
// Everything here reads public data: the author's atproto repo and the
// annotated page itself. Nothing is stored apart from short-lived cache.

export const COLLECTIONS = ["at.margin.note", "at.margin.annotation", "at.margin.highlight"];
const PUBLIC_API = "https://public.api.bsky.app/xrpc";
const UA = "joshuashew.com-margin/1.0 (+https://joshuashew.com/margin/)";

// Margin hashes the URL without its scheme, so these normalisations are
// identical to the ones the page itself uses (keep the two in step).
export function normUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    const q = new URLSearchParams(u.search);
    for (const k of [...q.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|ref_src$|mc_)/i.test(k)) q.delete(k);
    q.sort();
    const qs = q.toString();
    return host + (u.port ? ":" + u.port : "") + path + (qs ? "?" + qs : "");
  } catch {
    return String(raw).trim().replace(/^[a-z]+:\/\//i, "").replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

async function getJSON(url, ms = 6000) {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.json();
}

export async function resolveActor(input) {
  const id = input.trim().replace(/^@/, "").replace(/^at:\/\//, "");
  let did = id.startsWith("did:") ? id : null;
  if (!did) {
    try { did = (await getJSON(`${PUBLIC_API}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(id.toLowerCase())}`)).did; }
    catch {
      const r = await fetch(`https://${id.toLowerCase()}/.well-known/atproto-did`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
      const t = r && r.ok ? (await r.text()).trim() : "";
      if (!t.startsWith("did:")) throw new Error("handle not found");
      did = t;
    }
  }
  const doc = did.startsWith("did:plc:") ? await getJSON(`https://plc.directory/${did}`)
    : did.startsWith("did:web:") ? await getJSON(`https://${decodeURIComponent(did.slice(8))}/.well-known/did.json`)
    : null;
  if (!doc) throw new Error("unsupported DID");
  const pds = (doc.service || []).find((s) => s.id === "#atproto_pds" || s.id === `${did}#atproto_pds`);
  if (!pds) throw new Error("no PDS");
  const aka = (doc.alsoKnownAs || []).find((a) => a.startsWith("at://"));
  return { did, pds: pds.serviceEndpoint.replace(/\/+$/, ""), handle: aka ? aka.slice(5) : null };
}

async function listAll(pds, did, collection) {
  const out = []; let cursor;
  for (let i = 0; i < 12; i++) {
    const d = await getJSON(`${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${collection}&limit=100${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`)
      .catch((e) => { if (/^40[04]/.test(e.message)) return { records: [] }; throw e; });
    out.push(...d.records);
    if (!d.cursor || !d.records.length) break;
    cursor = d.cursor;
  }
  return out;
}

export async function recordsFor(actor, url) {
  const key = normUrl(url);
  const recs = (await Promise.all(COLLECTIONS.map((c) => listAll(actor.pds, actor.did, c)))).flat();
  return recs.filter((r) => r.value && r.value.target && r.value.target.source && normUrl(r.value.target.source) === key)
    .map((r) => {
      const v = r.value, sel = v.target.selector || {};
      const col = r.uri.split("/")[3], body = (v.body && v.body.value) || v.text || "";
      return { uri: r.uri, title: v.target.title || "", source: v.target.source, exact: sel.exact || "", body,
        createdAt: v.createdAt || "", kind: col === "at.margin.highlight" || v.motivation === "highlighting" || !body.trim() ? "highlight" : "note" };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function profile(did) {
  return getJSON(`${PUBLIC_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`, 4000).catch(() => null);
}

// ---------- the annotated page ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m));
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i")); return m ? decode(m[2] ?? m[3] ?? "") : null; };

function metaFrom(html) {
  const head = html.slice(0, 200000), out = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const k = (attr(tag, "property") || attr(tag, "name") || "").toLowerCase(), v = attr(tag, "content");
    if (v && ["og:title", "og:description", "og:image", "twitter:image", "description"].includes(k) && !out[k]) out[k] = v;
  }
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    if ((attr(tag, "rel") || "").toLowerCase() === "site.standard.document") { out.doc = attr(tag, "href"); break; }
  }
  const t = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) out.title = decode(t[1]).trim();
  return out;
}
function textFrom(html) {
  const body = (html.match(/<body[\s\S]*<\/body>/i) || [html])[0];
  return decode(body.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|section|article|br|tr)>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

// Page facts for previews and ordering. Prefer the standard.site document
// record (the author's canonical text in their own repo); fall back to the
// page's HTML text when the record is missing or its text is clipped.
export async function pageInfo(url) {
  const out = { url, title: null, description: null, image: null, doc: null, text: null, textSource: null };
  let html = "";
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(6000) });
    if (r.ok && /html|xml/i.test(r.headers.get("content-type") || "")) {
      const reader = r.body.getReader(); const chunks = []; let n = 0;
      while (n < 3_000_000) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; }
      reader.cancel().catch(() => {});
      html = new TextDecoder().decode(chunks.reduce((a, c) => { const m = new Uint8Array(a.length + c.length); m.set(a); m.set(c, a.length); return m; }, new Uint8Array()));
    }
  } catch {}
  const meta = html ? metaFrom(html) : {};
  out.title = meta["og:title"] || meta.title || null;
  out.description = meta["og:description"] || meta.description || null;
  out.image = meta["og:image"] || meta["twitter:image"] || null;
  if (out.image) { try { out.image = new URL(out.image, url).href; } catch { out.image = null; } }

  if (meta.doc && /^at:\/\/did:[^/]+\/site\.standard\.document\/[^/]+$/.test(meta.doc)) {
    try {
      const [, , repo, collection, rkey] = meta.doc.split("/");
      const author = await resolveActor(repo);
      const rec = await getJSON(`${author.pds}/xrpc/com.atproto.repo.getRecord?repo=${repo}&collection=${collection}&rkey=${rkey}`);
      const v = rec.value || {};
      out.doc = { uri: meta.doc, title: v.title || null };
      if (v.title && !out.title) out.title = v.title;
      if (v.description && !out.description) out.description = v.description;
      const tc = typeof v.textContent === "string" ? v.textContent : "";
      const clipped = !tc || tc.length >= 9900 || /…\s*$/.test(tc);
      if (tc && !clipped) { out.text = tc; out.textSource = "standard.site"; }
    } catch {}
  }
  if (!out.text && html) { const t = textFrom(html); if (t.length > 40) { out.text = t; out.textSource = "html"; } }
  return out;
}

export async function cached(request, ctx, key, ttl, make) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const ck = new Request(new URL(key, request.url).toString());
  if (cache) { const hit = await cache.match(ck).catch(() => null); if (hit) return hit.json(); }
  const val = await make();
  if (cache && val) {
    const res = new Response(JSON.stringify(val), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` } });
    ctx.waitUntil(cache.put(ck, res).catch(() => {}));
  }
  return val;
}
