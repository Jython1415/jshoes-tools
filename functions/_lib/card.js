// The /margin/ share image: a stack of the person's notes on one page
// ("note stack", concept D). Layout is built as a satori element tree, so
// note text is never parsed as markup.
import { setup, renderPng } from "../_vendor/og-render.js";

export const W = 1200, H = 630;

// Best available name for the annotated page: the standard.site record's
// title, the title Margin stored with the note, the page's own title, or a
// readable form of the URL's last path segment (PDFs have none of the others).
export function titleFor(recs, page, url) {
  const t = (page && page.doc && page.doc.title) || (recs.find((r) => r.title) || {}).title || (page && page.title);
  if (t) return t;
  try {
    const u = new URL(url), seg = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "");
    const name = seg.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ").trim();
    return name || u.hostname.replace(/^www\./, "");
  } catch { return url; }
}
export async function version(recs) {
  const key = recs.map((r) => r.uri + "@" + r.createdAt).sort().join("|");
  const d = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(key)));
  return [...d.slice(0, 5)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const C = { bg: "#18181b", card: "#27272a", ink: "#fafafa", ink2: "#d4d4d8", ink3: "#a1a1aa", rule: "#52525b", hl: "#facc15" };

// ---------- reading order (kept in step with locate() in margin/index.html) ----------
export const NQ = (s) => String(s || "").replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
export function locate(text, exact) {
  const e = NQ(exact); if (!e || !text) return null;
  let i = text.indexOf(e); if (i >= 0) return i;
  const w = e.split(" ");
  if (w.length >= 6) {
    i = text.indexOf(w.slice(0, 6).join(" ")); if (i >= 0) return i;
    i = text.indexOf(w.slice(-6).join(" ")); if (i >= 0) return i;
  }
  return null;
}
export function inPageOrder(recs, pageText) {
  const t = pageText ? NQ(pageText) : "";
  return recs.map((r) => ({ ...r, pos: locate(t, r.exact) }))
    .sort((a, b) => (a.pos ?? Infinity) - (b.pos ?? Infinity) || (a.createdAt < b.createdAt ? -1 : 1));
}

// ---------- fonts and emoji ----------
async function googleFonts(css2Query, text) {
  // No user agent: Google then serves TrueType, which satori can read (it cannot read woff2).
  const css = await (await fetch(`https://fonts.googleapis.com/css2?${css2Query}&text=${encodeURIComponent(text)}`, { cf: { cacheTtl: 86400, cacheEverything: true } })).text();
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
  return Promise.all(faces.map(async (f) => {
    const name = (f.match(/font-family:\s*'([^']+)'/) || [])[1];
    const style = (f.match(/font-style:\s*(\w+)/) || [])[1] || "normal";
    const weight = +((f.match(/font-weight:\s*(\d+)/) || [])[1] || 400);
    const url = (f.match(/src:\s*url\(([^)]+)\)/) || [])[1];
    const data = await (await fetch(url, { cf: { cacheTtl: 2592000, cacheEverything: true } })).arrayBuffer();
    return { name, style, weight, data };
  }));
}
// Twemoji file names keep U+FE0F inside ZWJ sequences and drop it elsewhere;
// pasted emoji often carry stray or doubled FE0F, so try both spellings.
function emojiCodes(seg) {
  const cps = [...seg].map((c) => c.codePointAt(0).toString(16)).filter((c, i, a) => !(c === "fe0f" && a[i - 1] === "fe0f"));
  const zwj = cps.includes("200d");
  const trimmed = cps.join("-").replace(/(-fe0f)+$/, "");
  return [...new Set([cps.join("-"), trimmed + (zwj ? "-fe0f" : ""), trimmed, cps.filter((c) => c !== "fe0f").join("-")])];
}
async function extraAsset(code, segment) {
  if (code === "emoji") {
    for (const code of emojiCodes(segment)) {
      const r = await fetch(`https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${code}.svg`, { cf: { cacheTtl: 2592000, cacheEverything: true } }).catch(() => null);
      if (r && r.ok) return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(await r.text())));
    }
    return undefined;
  }
  // Scripts the main faces lack (CJK, Arabic, Cyrillic…): Noto Sans subset for just this text.
  const family = { "ja-JP": "Noto+Sans+JP", "ko-KR": "Noto+Sans+KR", "zh-CN": "Noto+Sans+SC", "zh-TW": "Noto+Sans+TC", "zh-HK": "Noto+Sans+HK", ar: "Noto+Sans+Arabic", he: "Noto+Sans+Hebrew", th: "Noto+Sans+Thai", devanagari: "Noto+Sans+Devanagari", bn: "Noto+Sans+Bengali" }[code] || "Noto+Sans";
  try { return (await googleFonts(`family=${family}:wght@400`, segment)).map((f) => ({ ...f, name: "Fallback " + code })); }
  catch { return []; }
}

// ---------- layout ----------
const clipLine = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const el = (type, style, ...children) => ({ type, props: { style: { display: "flex", ...style }, children: children.length === 1 ? children[0] : children } });

function noteCard(r) {
  const quote = el("div", { borderLeft: `5px solid ${r.kind === "highlight" ? C.hl : C.rule}`, paddingLeft: 18, fontStyle: "italic", fontSize: 26, color: C.ink2, ...clipLine }, `“${r.exact.replace(/\s+/g, " ").trim()}”`);
  const kids = r.exact ? [quote] : [];
  if (r.body.trim()) kids.push(el("div", { paddingLeft: 23, fontSize: 27, fontWeight: 500, color: C.ink, ...clipLine }, r.body.replace(/\s+/g, " ").trim()));
  return el("div", { flexDirection: "column", gap: 8, background: C.card, borderRadius: 16, padding: "16px 24px", flexShrink: 0 }, ...kids);
}
// Measured from renders: padding 32, quote line 30, gap 8, note line 35.
const cardHeight = (r) => 32 + (r.exact ? 30 : 0) + (r.body.trim() ? (r.exact ? 8 : 0) + 35 : 0);

export function layout({ title, subtitle, avatar, notes }) {
  const STACK_H = H - 54 - 40 - 82 - 28; // canvas minus top/bottom padding, header and gap
  const shown = []; let used = 0;
  for (const r of notes) {
    const h = cardHeight(r) + (shown.length ? 14 : 0);
    const reserve = notes.length - shown.length - 1 > 0 ? 40 : 0; // room for "+N more"
    if (used + h + reserve > STACK_H) break;
    shown.push(r); used += h;
  }
  if (!shown.length && notes.length) shown.push(notes[0]);
  const more = notes.length - shown.length;
  const head = el("div", { alignItems: "center", gap: 22, height: 82 },
    avatar ? { type: "img", props: { src: avatar, width: 76, height: 76, style: { borderRadius: 38 } } } : el("div", { width: 76, height: 76, borderRadius: 38, background: C.rule }),
    el("div", { flexDirection: "column", gap: 4, flex: 1, minWidth: 0 },
      el("div", { fontFamily: "Outfit", fontWeight: 700, fontSize: 44, lineHeight: 1.1, color: C.ink, ...clipLine }, title),
      el("div", { fontSize: 24, color: C.ink3, ...clipLine }, subtitle)));
  const stack = el("div", { flexDirection: "column", gap: 14, flex: 1 }, ...shown.map(noteCard),
    ...(more > 0 ? [el("div", { fontSize: 24, color: C.ink3, paddingLeft: 6 }, `+${more} more`)] : []));
  return el("div", { width: W, height: H, flexDirection: "column", gap: 28, padding: 54, paddingBottom: 40, background: C.bg, fontFamily: "Inter", color: C.ink }, head, stack);
}

function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  const c = node.props && node.props.children;
  return Array.isArray(c) ? c.map(textOf).join("") : textOf(c);
}

// Bluesky's image CDN negotiates WebP, which resvg cannot decode, so ask for
// JPEG/PNG only and drop the avatar rather than fail the whole card.
export async function imageData(url) {
  if (!url) return null;
  // cdn.bsky.app picks the format from a suffix; without one it serves WebP.
  if (/^https:\/\/cdn\.bsky\.app\/img\//.test(url) && !/@(jpeg|png)$/.test(url)) url = url.replace(/@\w+$/, "") + "@jpeg";
  try {
    const r = await fetch(url, { headers: { accept: "image/jpeg,image/png;q=0.9" }, cf: { cacheTtl: 86400, cacheEverything: true } });
    const type = (r.headers.get("content-type") || "").split(";")[0];
    if (!r.ok || !/^image\/(jpeg|png)$/.test(type)) return null;
    const b = new Uint8Array(await r.arrayBuffer()); let bin = "";
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(bin)}`;
  } catch { return null; }
}

export async function renderCard(spec, wasm) {
  await setup(wasm.yoga, wasm.resvg);
  const tree = layout({ ...spec, avatar: await imageData(spec.avatarUrl) });
  // Only Latin text goes in the font subset, so emoji and other scripts reach loadAdditionalAsset.
  const text = [...new Set(textOf(tree) + "+0123456789 …“”")].filter((c) => /[\u0020-\u024f\u2000-\u206f\u20ac\u2122]/.test(c) && c !== "\u200d").join("");
  const fonts = [
    ...(await googleFonts("family=Inter:ital,wght@0,400;0,500;1,400", text)),
    ...(await googleFonts("family=Outfit:wght@700", text)),
  ];
  return renderPng(tree, { width: W, height: H, fonts, loadAdditionalAsset: extraAsset });
}
