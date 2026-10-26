/* Neon Grade simulation: pure, renderer-free, deterministic for a seed and an input sequence.
   Frame: s = horizontal distance forward, x = lateral (right +), y = up. The track falls about 45 degrees. */
var NG = (function () {
  "use strict";
  var R = 0.5;            // ball radius (m)
  var GRAV = 34;          // gravity (m/s^2); a touch above real for a snappy feel
  var DT = 1 / 240;       // fixed physics step; travel per step stays under 0.2 m
  var STEP = 0.32;        // tallest ledge the ball rolls up instead of crashing into
  var THICK = 0.9;        // tile thickness
  var MARGIN = 0.3;       // how close a face must be for the ball to touch it
  var V0 = 17, VMAX = 38, VACC = 0, BOOST = 3;
  var AX_G = 62, AX_A = 40, BANK_ROLL = 0.65;
  var B = 8;              // spatial bucket size (m)
  var EMPTY = [];

  function latMax(vs) { return 8.5 + vs * 0.13; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function World(seed) {
    this.seed = seed >>> 0;
    this.rnd = mulberry32(this.seed);
    this.tiles = []; this.obs = []; this.marks = []; this.boosts = []; this.deco = [];
    this.tb = new Map(); this.obb = new Map();
    this.c = { s: -40, y: 0, cx: 0, w: 9, grade: -1 };
    this.last = ""; this.log = [];
    this.section = 1; this.queue = []; this.blocks = 0;
    // Start inside a chevron tunnel, like the original.
    var t = this.seg(70, { w: 9, grade: -0.9 });
    t.chev = true; this.deco.push({ kind: "tunnel", s0: t.s0, s1: t.s1, t: t });
    this.mark();
    this.pStraight(40);
  }
  var P = World.prototype;
  P.r = function (a, b) { return a + (b - a) * this.rnd(); };
  P.diff = function () { return clamp(this.c.s / 4000, 0, 1); };
  P.targetSpeed = function (s) {
    var n = 0, bs = this.boosts;
    for (var i = bs.length - 1; i >= 0; i--) if (bs[i] <= s) { n = i + 1; break; }
    return Math.min(VMAX, V0 + Math.max(0, s) * VACC + n * BOOST);
  };
  P.bucket = function (map, o, a, b) {
    for (var k = Math.floor(a / B); k <= Math.floor(b / B); k++) {
      var arr = map.get(k); if (!arr) { arr = []; map.set(k, arr); } arr.push(o);
    }
  };
  P.addTile = function (s0, s1, x0, x1, y0, y1, b0, b1) {
    var t = { id: this.tiles.length, s0: s0, s1: s1, x0: x0, x1: x1, y0: y0, y1: y1,
      k: (y1 - y0) / (s1 - s0), b0: b0 || 0, b1: b1 || 0, xc: (x0 + x1) / 2, chev: false };
    this.tiles.push(t);
    this.bucket(this.tb, t, s0 - 1, s1 + 1);
    return t;
  };
  // mv: {amp, om, ph} slides sideways; up: {amp, om, ph} lifts the block off the deck and back.
  P.addObs = function (t, s0, s1, x0, x1, h, mv, up) {
    var o = { id: this.obs.length, t: t, s0: s0, s1: s1, x0: x0, x1: x1, h: h,
      amp: 0, om: 0, ph: 0, uamp: 0, uom: 0, uph: 0 };
    if (mv) { o.amp = mv.amp; o.om = mv.om; o.ph = mv.ph; }
    if (up) { o.uamp = up.amp; o.uom = up.om; o.uph = up.ph; }
    this.obs.push(o);
    this.bucket(this.obb, o, s0 - 1, s1 + 1);
    return o;
  };
  P.bank = function (t, s) { return t.b0 + (t.b1 - t.b0) * (s - t.s0) / (t.s1 - t.s0); };
  P.h = function (t, s, x) { return t.y0 + t.k * (s - t.s0) + this.bank(t, s) * (x - t.xc); };
  P.tilesAt = function (s) { return this.tb.get(Math.floor(s / B)) || EMPTY; };
  P.obsAt = function (s) { return this.obb.get(Math.floor(s / B)) || EMPTY; };
  P.mark = function () { this.marks.push(this.c.s); };
  // Consecutive tiles overlap sideways by at least 2.6 m, so a path always exists.
  P.shiftCx = function (want, w) {
    var c = this.c, lim = Math.max(0, (c.w + w) / 2 - 2.6);
    return clamp(want, c.cx - lim, c.cx + lim);
  };
  P.nextGrade = function () { return clamp(this.c.grade + this.r(-0.07, 0.07), -1.12, -0.88); };
  P.seg = function (len, o) {
    o = o || {};
    var c = this.c;
    var w = o.w != null ? o.w : c.w, cx = o.cx != null ? o.cx : c.cx, g = o.grade != null ? o.grade : c.grade;
    var y0 = c.y + (o.dy || 0);
    var t = this.addTile(c.s, c.s + len, cx - w / 2, cx + w / 2, y0, y0 + g * len, o.b0, o.b1);
    c.s += len; c.y = t.y1; c.cx = cx; c.w = w; c.grade = g;
    return t;
  };

  // ---- pieces ---------------------------------------------------------------
  P.pStraight = function (len) {
    var w = this.r(8.5, 11.5);
    this.seg(len || this.r(25, 45), { w: w, cx: this.shiftCx(this.c.cx + this.r(-4, 4), w), grade: this.nextGrade() });
  };
  // "Five obstacle": rows of magenta pillars, always with a reachable opening.
  P.pPillars = function (vertical, sparse) {
    var vs = this.targetSpeed(this.c.s), w = this.r(9, 11.5);
    var lead = Math.max(14, vs * 0.75);
    var t = this.seg(this.r(70, 110), { w: w, cx: this.shiftCx(this.c.cx + this.r(-3, 3), w), grade: this.nextGrade() });
    this.rows(t, t.s0 + lead, t.s1 - 12, vertical, sparse);
  };
  P.rows = function (t, sA, sB, vertical, sparse) {
    var d = this.diff(), s = sA, gx = this.r(t.x0 + 1.5, t.x1 - 1.5);
    while (s < sB) {
      var vs = this.targetSpeed(s), vm = latMax(vs);
      var sp = Math.max(9, vs * this.r(0.45, 0.62) * (1.1 - 0.25 * d)) * (sparse ? 1.8 : 1);
      var gw = 2.9 - 0.5 * d;
      var reach = 0.4 * vm * sp / vs;
      gx = clamp(gx + this.r(-reach, reach), t.x0 + gw / 2 + 0.15, t.x1 - gw / 2 - 0.15);
      var depth = this.r(0.9, 1.5), hgt = vertical ? this.r(1.6, 2.4) : this.r(1.4, 5.5);
      var wall = !sparse && this.rnd() < 0.35;
      this.fillRow(t, s, depth, t.x0, gx - gw / 2, wall, hgt, vertical);
      this.fillRow(t, s, depth, gx + gw / 2, t.x1, wall, hgt, vertical);
      s += sp + depth;
    }
  };
  P.fillRow = function (t, s, depth, a, b, wall, h, vertical) {
    if (b - a < 0.5) return;
    var self = this;
    function add(x0, x1, hh) {
      // the original's risers bounce between the deck and 16 m at 8 m/s
      var up = vertical ? { amp: 16, om: 8, ph: self.r(0, 2) } : null;
      self.addObs(t, s, s + depth, x0, x1, hh, null, up);
    }
    if (wall) { add(a, b, h); return; }
    var x = a, placed = false;
    while (x < b - 0.4) {
      var cw = Math.min(this.r(1, 2.2), b - x);
      if (this.rnd() < 0.6 || (!placed && x + cw >= b - 0.4)) { add(x, x + cw, h * this.r(0.7, 1.3)); placed = true; }
      x += cw + this.r(0.3, 1.6);
    }
  };
  // "Tilt left / tilt right": a wide deck that banks one way, then the other.
  P.pTilt = function (dir) {
    var w = this.r(12, 15), b = this.r(0.22, 0.36) * dir;
    var cx = this.shiftCx(this.c.cx, w);
    this.seg(12, { w: w, cx: cx, b0: 0, b1: b, grade: this.nextGrade() });
    this.seg(this.r(35, 50), { b0: b, b1: b });
    this.seg(12, { b0: b, b1: 0 });
  };
  // Ballistic height of the ball's bottom after travelling ds forward from a launch.
  function arc(y, v, k, ds) { var t = ds / v; return y + v * k * t - 0.5 * GRAV * t * t; }
  // "Thin jump": a narrow run ending in a ramp over a gap.
  P.pGap = function () {
    var c = this.c, kick = this.rnd() < 0.7;
    if (true) { var wn = this.r(4.2, 5.2); this.seg(this.r(25, 40), { w: wn, cx: this.shiftCx(c.cx, wn) }); }
    if (kick) this.seg(this.r(4, 6), { grade: this.r(-0.35, -0.1) });
    var ls = c.s, ly = c.y, k = c.grade, vs = this.targetSpeed(ls);
    var G = kick ? this.r(4, 4 + vs * 0.2) : this.r(3, 3 + vs * 0.08);
    // Landing deck top sits below every plausible arc over its first 1.2 m, so the ball always clears the lip.
    var y2 = Infinity;
    for (var i = 0; i <= 4; i++) {
      var v = vs * (0.85 + 0.05 * i);
      y2 = Math.min(y2, arc(ly, v, k, G), arc(ly, v, k, G + 1.2));
    }
    y2 -= 0.2;
    var vmax = vs * 1.05, vy = vmax * k;
    var tl = (vy + Math.sqrt(vy * vy + 2 * GRAV * Math.max(0, ly - y2))) / GRAV;
    // the deck falls at 45 degrees too; measure the flight against it generously
    var len = Math.max(45, vmax * tl * 1.6 - G + 25);
    c.s = ls + G; c.y = y2;
    var w = Math.max(c.w, 9.5);
    this.seg(len, { w: w, grade: -1 });
  };
  // "Dogleg": a narrow path that winds side to side.
  P.pDogleg = function () {
    var d = this.diff(), w = this.r(3.9, 4.6) - 0.8 * d;
    var vs = this.targetSpeed(this.c.s);
    this.seg(Math.max(12, vs * 0.4), { w: w, cx: this.shiftCx(this.c.cx, w) });
    var n = Math.floor(this.r(3, 7.99));
    for (var i = 0; i < n; i++) {
      vs = this.targetSpeed(this.c.s);
      var dx = this.r(-1, 1) * (w - 2.6);
      var len = Math.max(10, Math.abs(dx) * vs / (0.4 * latMax(vs)) + 6);
      this.seg(len, { cx: this.c.cx + dx, grade: this.nextGrade() });
    }
    var w2 = this.r(8.5, 10.5);
    this.seg(this.r(25, 35), { w: w2, cx: this.shiftCx(this.c.cx, w2) });
  };
  // "Death tunnel": a narrow straight between magenta walls. Touch a wall and the run ends.
  P.pDeathTunnel = function () {
    var w = this.r(3.7, 4.6);
    var vs = this.targetSpeed(this.c.s);
    this.seg(Math.max(14, vs * 0.5), { w: w + 2, cx: this.shiftCx(this.c.cx, w + 2) });
    var t = this.seg(this.r(40, 70), { w: w, cx: this.c.cx, grade: this.nextGrade() });
    this.addObs(t, t.s0, t.s1, t.x0, t.x0 + 0.35, 3.2);
    this.addObs(t, t.s0, t.s1, t.x1 - 0.35, t.x1, 3.2);
    this.deco.push({ kind: "deathTunnel", s0: t.s0, s1: t.s1, t: t });
    var w2 = this.r(8.5, 10.5);
    this.seg(this.r(20, 30), { w: w2, cx: this.shiftCx(this.c.cx, w2) });
  };
  // "Horizontal obstacle": blocks sliding across the deck.
  P.pSliders = function () {
    var d = this.diff(), w = this.r(9.5, 11.5);
    var vs = this.targetSpeed(this.c.s);
    var t = this.seg(this.r(80, 120), { w: w, cx: this.shiftCx(this.c.cx, w), grade: this.nextGrade() });
    var s = t.s0 + Math.max(16, vs * 0.75);
    while (s < t.s1 - 12) {
      vs = this.targetSpeed(s);
      var bw = this.r(2, 3.2), A = (w - bw) / 2 - 0.05, cx = (t.x0 + t.x1) / 2;
      this.addObs(t, s, s + 1.2, cx - bw / 2, cx + bw / 2, this.r(1.6, 3), { amp: A, om: this.r(3, 4), ph: this.r(0, 2) });
      s += Math.max(14, vs * this.r(0.6, 0.8));
    }
  };
  // "Speed up": a chevron tunnel that pushes the ball faster.
  P.pSpeedRun = function () {
    var w = 9;
    this.seg(12, { w: w, cx: this.shiftCx(this.c.cx, w), grade: this.nextGrade() });
    var t = this.seg(this.r(45, 60), { w: w, grade: this.c.grade });
    t.chev = true;
    this.boosts.push(t.s0);
    this.deco.push({ kind: "tunnel", s0: t.s0, s1: t.s1, t: t });
    this.seg(this.r(20, 30), { w: this.r(8.5, 10.5) });
  };
  // Sections, as in the original's level loader: section 1 is one easy block, section 2 two easy
  // and two medium, section 3 three of each tier, then four of each. Each batch repeats one
  // weighted group, and every section ends with a speed-up tunnel that pushes the ball faster.
  var GROUPS = {
    easy: [["easyObstacle", 1], ["thinJump", 1], ["tilt", 2]],
    medium: [["fiveObstacle", 1], ["deathTunnel", 1], ["dogleg", 1]],
    hard: [["vertical", 1], ["horizontal", 1]]
  };
  P.pickGroup = function (tier) {
    var self = this, g = GROUPS[tier].filter(function (x) { return !(x[0] === "dogleg" && self.blocks >= 50); });
    var tot = 0, i; for (i = 0; i < g.length; i++) tot += g[i][1];
    var r = this.rnd() * tot;
    for (i = 0; i < g.length; i++) { r -= g[i][1]; if (r < 0) return g[i][0]; }
    return g[g.length - 1][0];
  };
  P.fillSection = function () {
    var r = this.section++, n = r === 1 ? [1, 0, 0] : r === 2 ? [2, 2, 0] : r === 3 ? [3, 3, 3] : [4, 4, 4];
    var tiers = ["easy", "medium", "hard"];
    for (var i = 0; i < 3; i++) if (n[i]) { var grp = this.pickGroup(tiers[i]); for (var j = 0; j < n[i]; j++) this.queue.push(grp); }
    this.queue.push("speed");
  };
  P.piece = function () {
    if (!this.queue.length) this.fillSection();
    var s = this.c.s, k = this.queue.shift();
    this.last = k; this.log.push([Math.round(s), k]); this.blocks++;
    switch (k) {
      case "speed": this.pSpeedRun(); break;
      case "easyObstacle": this.pPillars(false, true); break;
      case "fiveObstacle": this.pPillars(false, false); break;
      case "vertical": this.pPillars(true, false); break;
      case "tilt": this.pTilt(this.rnd() < 0.5 ? 1 : -1); break;
      case "thinJump": this.pGap(); break;
      case "dogleg": this.pDogleg(); break;
      case "deathTunnel": this.pDeathTunnel(); break;
      case "horizontal": this.pSliders(); break;
    }
    this.mark();
  };
  P.ensure = function (s) { while (this.c.s < s) this.piece(); };

  // ---- ball -----------------------------------------------------------------
  function Ball(world) {
    var t = world.tiles[0];
    this.x = 0; this.s = 0; this.by = world.h(t, 0, 0) + 2.5;
    this.vx = 0; this.vs = V0; this.vy = 0;
    this.ground = null; this.t = 0; this.dead = false; this.cause = "";
    this.lastGY = this.by; this.lastGS = 0;
    this.air = 0; this.airTotal = 0; this.topSpeed = V0; this.landed = 0;
    this.score = 0; this.mi = 0; this.bi = 0; this.boosted = 0;
  }
  Ball.prototype.clone = function () {
    var b = Object.create(Ball.prototype);
    for (var k in this) if (Object.prototype.hasOwnProperty.call(this, k)) b[k] = this[k];
    return b;
  };
  function die(b, cause) { b.dead = true; b.cause = cause; }
  // Constant-speed ping-pong: om is speed in m/s, ph a phase in [0, 2).
  function tri(t, speed, span, ph) { var u = (t * speed / span + ph) % 2; return u < 1 ? u : 2 - u; }
  function obsOffset(o, t) { return o.amp ? -o.amp + 2 * o.amp * tri(t, o.om, 2 * o.amp, o.ph) : 0; }
  function obsLift(o, t) { return o.uamp ? o.uamp * tri(t, o.uom, o.uamp, o.uph) : 0; }

  function step(w, b, inp) {
    if (b.dead) return;
    if (w.c.s < b.s + 600) w.ensure(b.s + 900);
    b.t += DT;
    var g = b.ground;
    if (g) b.vs += clamp(w.targetSpeed(b.s) - b.vs, -8 * DT, (g.chev ? 22 : 8) * DT);
    if (b.vs > b.topSpeed) b.topSpeed = b.vs;

    var vm = latMax(b.vs), ax = g ? AX_G : AX_A;
    if (inp) { var a = inp * ax; if (inp * b.vx < 0) a *= 1.8; b.vx += a * DT; }
    else b.vx *= Math.exp(-(g ? 7 : 2) * DT);
    var bank = g ? w.bank(g, b.s) : 0;
    if (bank) b.vx -= GRAV * bank * BANK_ROLL * DT;   // a banked deck rolls the ball downhill sideways
    b.vx = clamp(b.vx, -vm, vm);

    var pby = b.by;
    // vertical speed while grounded follows the surface: d/dt h(s, x)
    var vy = g ? b.vs * (g.k + (g.b1 - g.b0) / (g.s1 - g.s0) * (b.x - g.xc)) + b.vx * bank : b.vy;
    b.x += b.vx * DT; b.s += b.vs * DT;
    var bal = pby + vy * DT - 0.5 * GRAV * DT * DT;   // where a free ball would be
    vy -= GRAV * DT;

    var list = w.tilesAt(b.s), sup = null, supH = -1e9;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (b.s < t.s0 - MARGIN || b.s > t.s1) continue;
      var inS = b.s >= t.s0, inX = b.x >= t.x0 && b.x <= t.x1;
      var h = w.h(t, inS ? b.s : t.s0, clamp(b.x, t.x0, t.x1));
      var under = h - THICK > bal + 2 * R;           // ball is entirely below this slab
      if (inS && inX) {
        if (h > bal + STEP) { if (!under) { b.by = bal; return die(b, "wall"); } continue; }
        if (h > supH) { supH = h; sup = t; }
      } else if (!under && h > bal + STEP) {
        var front = !inS && inX;
        var side = inS && ((b.x < t.x0 && b.x > t.x0 - MARGIN && b.vx > 0) || (b.x > t.x1 && b.x < t.x1 + MARGIN && b.vx < 0));
        if (front || side) { b.by = bal; return die(b, "wall"); }
      }
    }

    if (sup && supH >= bal) {
      if (!g && b.air > 0.12) b.landed = Math.min(1, (b.vy - sup.k * b.vs) / -25);
      b.by = supH; b.ground = sup; b.vy = vy;
      b.lastGY = supH; b.lastGS = b.s; b.air = 0;
    } else {
      b.by = bal; b.vy = vy; b.ground = null;
      b.air += DT; b.airTotal += DT;
      // the track never falls faster than about 1.25 m per metre forward
      if (b.by < b.lastGY - 1.6 * (b.s - b.lastGS) - 16) return die(b, "fall");
    }

    var ol = w.obsAt(b.s);
    for (var j = 0; j < ol.length; j++) {
      var o = ol[j];
      if (b.s + R < o.s0 || b.s - R > o.s1) continue;
      var off = obsOffset(o, b.t);
      var dx = Math.max(o.x0 + off - b.x, 0, b.x - o.x1 - off);
      var ds = Math.max(o.s0 - b.s, 0, b.s - o.s1);
      if (dx * dx + ds * ds < 0.42 * 0.42) {
        var cs = clamp(b.s, o.t.s0, o.t.s1);
        var base = w.h(o.t, cs, clamp(b.x, o.x0 + off, o.x1 + off)) + obsLift(o, b.t);
        if (b.by < base + o.h - 0.05 && b.by + 2 * R > base + 0.05) return die(b, "block");
      }
    }
    while (b.mi < w.marks.length && w.marks[b.mi] <= b.s) { b.mi++; if (w.marks[b.mi - 1] > 0) b.score++; }
    while (b.bi < w.boosts.length && w.boosts[b.bi] <= b.s) { b.bi++; b.boosted++; }
  }

  return {
    R: R, DT: DT, THICK: THICK, GRAV: GRAV, V0: V0, VMAX: VMAX,
    World: World, Ball: Ball, step: step, latMax: latMax, obsOffset: obsOffset, obsLift: obsLift
  };
})();
if (typeof module !== "undefined") module.exports = NG;
