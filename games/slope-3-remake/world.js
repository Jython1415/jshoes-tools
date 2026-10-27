/* Slope 3 Remake world: places blocks the way the original's level loader does and answers the
   ball's collision and trigger queries. Block shapes come from S3BLOCKS (measured from the original).
   Unity coordinates throughout: x right, y up, z forward. */
var S3W = (function (P, DATA) {
  "use strict";
  var add = P.add, sub = P.sub, mul = P.mul, cross = P.cross, len = P.len;
  var BUCKET = 10, SQ2 = Math.SQRT1_2;
  function along(p) { return (p[2] - p[1]) * SQ2; }   // distance down the 45-degree slope
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Pre-process each block once: triangles with normals, trigger boxes, mover links, render material.
  var BLOCKS = {}, GROUPS = { easy: [], medium: [], hard: [] };
  (function prep() {
    DATA.blocks.forEach(function (b) {
      var mats = {};
      (b.renderBoxes || []).forEach(function (r) { mats[r.name] = r.material; });
      var movers = {};
      (b.movers || []).forEach(function (m) { if (m.enabled !== false) movers[m.collider] = m; });
      var rx = {};
      (b.randomX || []).forEach(function (m) { rx[m.collider] = m.range; });
      var cols = b.colliders.filter(function (c) { return c.enabled !== false && !c.isTrigger && c.triangles; }).map(function (c) {
        var tris = c.triangles.map(function (t) {
          var a = c.vertices[t[0]], bb = c.vertices[t[1]], cc = c.vertices[t[2]];
          var n = cross(sub(bb, a), sub(cc, a)), nl = len(n);
          return { a: a, b: bb, c: cc, n: nl > 0 ? mul(n, 1 / nl) : [0, 1, 0] };
        }).filter(function (t) { return len(t.n) > 0; });
        var lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
        c.vertices.forEach(function (v) { for (var i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], v[i]); hi[i] = Math.max(hi[i], v[i]); } });
        var mat = mats[c.name] || (/CollidePlane/.test(c.name) ? "invisible" : (c.tag === "Death" ? "Peril" : "Ground"));
        if (/CollidePlane/.test(c.name)) mat = "invisible";
        return { name: c.name, death: c.tag === "Death", tris: tris, lo: lo, hi: hi, mat: mat, mover: movers[c.name] || null, randomX: rx[c.name] || null };
      });
      var trig = b.triggers.filter(function (t) { return t.enabled !== false && t.kind !== "other"; }).map(function (t) {
        return { kind: t.kind, c: t.center, h: mul(t.size, 0.5), A: P.qmat(t.rot) };
      });
      var spec = { name: b.name, tier: b.tier, weight: b.weight, cols: cols, trig: trig,
        startTranslate: b.startTranslate, translates: b.translates, translateFirstBlock: b.translateFirstBlock };
      BLOCKS[b.name] = spec;
      if (b.spawnable !== false && GROUPS[b.tier]) GROUPS[b.tier].push(spec);
    });
  })();

  function World(seed) {
    this.rnd = mulberry32(seed >>> 0);
    this.cols = []; this.trigs = []; this.placed = []; this.buckets = new Map();
    this.marker = { p: DATA.world.spawnStart.pos.slice(), q: DATA.world.spawnStart.rot.slice() };
    this.repeats = 1; this.blocksPlaced = 0; this.doglegOff = false; this.firedSections = {};
    this.place(BLOCKS["Start Block"], 0, true);
  }
  var W = World.prototype;
  W.rr = function (a, b) { return a + (b - a) * this.rnd(); };
  W.translate = function (t) {
    if (!t) return;
    var v = [this.rr(t.x[0], t.x[1]), this.rr(t.y[0], t.y[1]), this.rr(t.z[0], t.z[1])];
    this.marker.p = add(this.marker.p, P.qrot(this.marker.q, v));
  };
  W.bucketAdd = function (o, lo, hi) {
    // bucket by distance down the slope, over the whole box the object can occupy
    var us = [along([0, lo[1], lo[2]]), along([0, lo[1], hi[2]]), along([0, hi[1], lo[2]]), along([0, hi[1], hi[2]])];
    var a = Math.floor(Math.min.apply(null, us) / BUCKET), b = Math.floor(Math.max.apply(null, us) / BUCKET);
    for (var k = a; k <= b; k++) { var arr = this.buckets.get(k); if (!arr) { arr = []; this.buckets.set(k, arr); } arr.push(o); }
  };
  // Put one block at the marker (rotation identity, as in the original), then advance the marker.
  W.place = function (spec, t0, isStart) {
    var o = this.marker.p.slice(), self = this, bi = this.placed.length;
    var blk = { spec: spec, origin: o, index: bi, cols: [], t0: t0 };
    spec.cols.forEach(function (c, ci) {
      // The original sets a random local x on enable (geometry here is recorded at x = 0), and movers
      // bounce their local x (sliders) or y (risers, recorded at their start height) between min and max.
      var shift = [0, 0, 0], mv = null;
      var rx = c.randomX ? self.rr(c.randomX[0], c.randomX[1]) : 0;
      if (c.mover) {
        var m = c.mover, axis = m.kind === "vertical" ? 1 : 0;
        var ref = axis === 1 ? (m.startLocalY || 0) : 0;
        mv = { axis: axis, speed: m.speed, min: m.min, max: m.max, x0: axis === 1 ? ref : rx, ref: ref };
      } else if (c.randomX) shift[0] = rx;
      var org = add(o, shift);
      var col = { id: bi + ":" + ci, blk: blk, src: c, origin: org, death: c.death, mat: c.mat, mover: mv,
        lo: add(c.lo, org), hi: add(c.hi, org) };
      if (mv) {   // bucket over the whole range it sweeps
        col.lo[mv.axis] += mv.min - mv.ref; col.hi[mv.axis] += mv.max - mv.ref;
      }
      blk.cols.push(col); self.cols.push(col); self.bucketAdd(col, col.lo, col.hi);
    });
    spec.trig.forEach(function (t, ti) {
      var tr = { id: "t" + bi + ":" + ti, kind: t.kind, c: add(t.c, o), h: t.h, A: t.A, blk: blk };
      var ext = [0, 0, 0];
      for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) ext[j] += Math.abs(t.A[i][j]) * t.h[i];
      self.trigs.push(tr); self.bucketAdd(tr, sub(tr.c, ext), add(tr.c, ext));
    });
    this.placed.push(blk);
    if (!isStart) this.blocksPlaced++;
    if (this.blocksPlaced >= 50) this.doglegOff = true;
    var self2 = this;
    spec.translates.forEach(function (t) { self2.translate(t); });
    return blk;
  };
  W.pickGroup = function (tier) {
    var groups = {}, order = [];
    GROUPS[tier].forEach(function (s) {
      var key = /^Tilt/.test(s.name) ? "Tilt" : s.name;
      if (!groups[key]) { groups[key] = { w: s.weight, specs: [] }; order.push(key); }
      groups[key].specs.push(s);
    });
    if (this.doglegOff && groups.Dogleg) groups.Dogleg.w = 0;
    var tot = 0; order.forEach(function (k) { tot += groups[k].w; });
    var r = this.rnd() * tot;
    for (var i = 0; i < order.length; i++) { r -= groups[order[i]].w; if (r < 0 && groups[order[i]].w > 0) return groups[order[i]].specs; }
    return groups[order[order.length - 1]].specs;
  };
  W.genBlocks = function (n, tier, t0) {
    var specs = this.pickGroup(tier);
    for (var i = 0; i < n; i++) {
      var s = specs[Math.floor(this.rnd() * specs.length)];
      if (i === 0 && s.translateFirstBlock) this.translate(s.translateFirstBlock);
      this.translate(s.startTranslate);
      this.place(s, t0, false);
    }
  };
  // The original builds the next section when the ball enters a speed-up zone.
  W.onSpeedUp = function (tg, ball) {
    if (this.firedSections[tg.id]) return;
    this.firedSections[tg.id] = true;
    var r = this.repeats++, t0 = ball ? ball.t : 0;
    if (r === 1) this.genBlocks(1, "easy", t0);
    else if (r === 2) { this.genBlocks(2, "easy", t0); this.genBlocks(2, "medium", t0); }
    else { var n = r === 3 ? 3 : 4; this.genBlocks(n, "easy", t0); this.genBlocks(n, "medium", t0); this.genBlocks(n, "hard", t0); }
    var sr = BLOCKS["Speed Run"]; this.translate(sr.startTranslate); this.place(sr, t0, false);
  };

  // Mover displacement along its axis at time t: a constant-speed bounce between min and max.
  function moverOffset(m, t, t0) {
    var L = m.max - m.min; if (L <= 0) return { x: m.x0, v: 0 };
    var d = m.speed * Math.max(0, t - t0);
    var u = (m.x0 - m.min) + d, k = u % (2 * L);
    return k <= L ? { x: m.min + k, v: m.speed } : { x: m.min + 2 * L - k, v: -m.speed };
  }
  W.colOffset = function (col, t) {
    if (!col.mover) return [0, 0, 0];
    var mo = moverOffset(col.mover, t, col.blk.t0), off = [0, 0, 0];
    off[col.mover.axis] = mo.x - col.mover.ref;
    return off;
  };
  W.query = function (p, r, t) {
    var k = Math.floor(along(p) / BUCKET), out = [], seen = {};
    for (var b = k - 1; b <= k + 1; b++) {
      var arr = this.buckets.get(b); if (!arr) continue;
      for (var i = 0; i < arr.length; i++) {
        var col = arr[i]; if (!col.src || seen[col.id]) continue; seen[col.id] = 1;
        if (p[0] + r < col.lo[0] || p[0] - r > col.hi[0] || p[1] + r < col.lo[1] || p[1] - r > col.hi[1] || p[2] + r < col.lo[2] || p[2] - r > col.hi[2]) continue;
        var o = col.origin, vel = [0, 0, 0];
        if (col.mover) {
          var mo = moverOffset(col.mover, t, col.blk.t0);
          o = o.slice(); o[col.mover.axis] += mo.x - col.mover.ref; vel[col.mover.axis] = mo.v;
        }
        var tris = col.src.tris;
        for (var j = 0; j < tris.length; j++) {
          var tr = tris[j];
          out.push({ id: col.id, kind: "tri", death: col.death, vel: vel, a: add(tr.a, o), b: add(tr.b, o), c: add(tr.c, o), n: tr.n, mu: col.mat === "invisible" ? 0.75 : 0.85 });
        }
      }
    }
    return out;
  };
  W.triggers = function (p, r, t) {
    var k = Math.floor(along(p) / BUCKET), out = [], seen = {};
    for (var b = k - 1; b <= k + 1; b++) {
      var arr = this.buckets.get(b); if (!arr) continue;
      for (var i = 0; i < arr.length; i++) {
        var tg = arr[i]; if (tg.src || seen[tg.id]) continue; seen[tg.id] = 1;
        if (P.sphereBoxOverlap(tg, p, r)) out.push(tg);
      }
    }
    return out;
  };
  W.floorBelow = function () { return this.marker.p[1] - 400; };   // only a backstop under the fallout zones

  return { World: World, BLOCKS: BLOCKS, DATA: DATA, along: along, moverOffset: moverOffset };
})(typeof S3P !== "undefined" ? S3P : require("./phys.js"), typeof S3BLOCKS !== "undefined" ? S3BLOCKS : require("./blocks.js"));
if (typeof module !== "undefined") module.exports = S3W;
