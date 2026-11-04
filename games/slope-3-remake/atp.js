// Bluesky (AT Protocol) sign-in and the public leaderboard.
// Scores live in each player's own repo as com.joshuashew.games.score records, the same shape as
// the mino.mobi arcade's com.minomobi.lab.score. The board is read straight from the network:
// the relay lists repos holding the collection, then each repo's records are read from its PDS.
const NSID = "com.joshuashew.games.score";
const ORIGIN = "https://joshuashew.com";
const CLIENT_ID = ORIGIN + "/games/client-metadata.json";
const RELAY = "https://relay1.us-east.bsky.network";
const OAUTH_LIB = "https://cdn.jsdelivr.net/npm/@atproto/oauth-client-browser@0.5.9/+esm";

export function createScores({ site, game, accept }) {
  const enabled = location.origin === ORIGIN;
  let client = null, session = null, handle = null;

  async function profileHandle(did) {
    try {
      const r = await fetch("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=" + encodeURIComponent(did));
      if (r.ok) return (await r.json()).handle || null;
    } catch (e) { /* fall through */ }
    return null;
  }

  async function init() {
    if (!enabled) return { enabled: false };
    const { BrowserOAuthClient } = await import(OAUTH_LIB);
    client = await BrowserOAuthClient.load({ clientId: CLIENT_ID, handleResolver: "https://bsky.social" });
    client.addEventListener("deleted", () => { session = null; handle = null; });
    const res = await client.init();
    if (res && res.session) {
      session = res.session;
      handle = await profileHandle(session.did);
    }
    return { enabled: true, did: session ? session.did : null, handle };
  }

  async function signIn(input) {
    if (!client) throw new Error("Sign-in is not available here");
    const h = String(input || "").trim().replace(/^@/, "");
    if (!h) throw new Error("Enter your Bluesky handle");
    // Redirects to the player's Bluesky sign-in page; the promise only settles if that fails.
    await client.signIn(h, { scope: "atproto repo:" + NSID + "?action=create" });
  }

  async function signOut() {
    if (session) { try { await session.signOut(); } catch (e) { /* already gone */ } }
    session = null; handle = null;
  }

  async function post(rec) {
    if (!session) throw new Error("Not signed in");
    const record = Object.assign({ $type: NSID, site, game, unit: "points", higherIsBetter: true, createdAt: new Date().toISOString() }, rec);
    const r = await session.fetchHandler("/xrpc/com.atproto.repo.createRecord", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: session.did, collection: NSID, record })
    });
    if (!r.ok) {
      let msg = "HTTP " + r.status;
      try { const j = await r.json(); msg = j.message || j.error || msg; } catch (e) { /* keep status */ }
      throw new Error(msg);
    }
    return r.json();
  }

  // ---- reading the board ----------------------------------------------------
  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status + " from " + new URL(url).host);
    return r.json();
  }
  async function didDoc(did) {
    if (did.startsWith("did:plc:")) return getJSON("https://plc.directory/" + did);
    if (did.startsWith("did:web:")) return getJSON("https://" + did.slice(8) + "/.well-known/did.json");
    throw new Error("unknown DID method");
  }
  function pdsOf(doc) {
    const s = (doc.service || []).find(x => x.id === "#atproto_pds" || x.id === doc.id + "#atproto_pds");
    return s && s.serviceEndpoint;
  }
  function handleOf(doc) {
    const a = (doc.alsoKnownAs || []).find(x => x.startsWith("at://"));
    return a ? a.slice(5) : null;
  }
  async function pool(items, n, fn) {
    const out = new Array(items.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; } }
    }));
    return out;
  }
  async function bestFor(did) {
    const doc = await didDoc(did), pds = pdsOf(doc);
    if (!pds) return null;
    let best = null, cursor = "";
    for (let page = 0; page < 10; page++) {
      const u = new URL(pds.replace(/\/$/, "") + "/xrpc/com.atproto.repo.listRecords");
      u.searchParams.set("repo", did); u.searchParams.set("collection", NSID); u.searchParams.set("limit", "100");
      if (cursor) u.searchParams.set("cursor", cursor);
      const j = await getJSON(u.toString());
      for (const r of j.records || []) {
        const v = r.value || {};
        if (v.site !== site || v.game !== game || !accept(v)) continue;
        if (!best || v.value > best.value || (v.value === best.value && v.createdAt < best.createdAt)) best = { value: v.value, createdAt: v.createdAt };
      }
      cursor = j.cursor; if (!cursor || !(j.records || []).length) break;
    }
    return best && { did, handle: handleOf(doc) || did, value: best.value, createdAt: best.createdAt };
  }
  async function board() {
    const dids = new Set(); let cursor = "";
    for (let page = 0; page < 5; page++) {
      const u = new URL(RELAY + "/xrpc/com.atproto.sync.listReposByCollection");
      u.searchParams.set("collection", NSID); u.searchParams.set("limit", "1000");
      if (cursor) u.searchParams.set("cursor", cursor);
      const j = await getJSON(u.toString());
      for (const r of j.repos || []) dids.add(r.did);
      cursor = j.cursor; if (!cursor) break;
    }
    if (session) dids.add(session.did);   // the relay can lag a fresh first post
    const rows = (await pool([...dids], 8, bestFor)).filter(Boolean);
    rows.sort((a, b) => b.value - a.value || String(a.createdAt).localeCompare(String(b.createdAt)));
    return rows;
  }

  return {
    get enabled() { return enabled; },
    get did() { return session ? session.did : null; },
    get handle() { return handle; },
    init, signIn, signOut, post, board
  };
}
