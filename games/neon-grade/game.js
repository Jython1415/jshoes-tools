/* Neon Grade: renderer, audio, input, game flow and score posting. Physics lives in sim.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var SITE = "neon-grade", GAME = "run-v1", VERSION = "0.1";
  var canvas = $("stage");
  var ui = {
    score: $("score"), hint: $("hint"), speedup: $("speedup"), pauseBtn: $("pauseBtn"),
    arrowL: $("arrowL"), arrowR: $("arrowR"), sound: $("soundBtn"),
    menu: $("menu"), board: $("board"), over: $("over"), paused: $("paused"),
    handle: $("handle"), signedOut: $("signedOut"), signedIn: $("signedIn"), whoHandle: $("whoHandle"), authNote: $("authNote"),
    boardRows: $("boardRows"), boardNote: $("boardNote"),
    finalScore: $("finalScore"), finalBest: $("finalBest"), postStatus: $("postStatus")
  };
  $("version").textContent = VERSION;

  // ---- storage (per-browser conveniences only) --------------------------------
  function load(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  var best = load("ng-best", null);          // {score, dist, t, seed}
  var pending = load("ng-pending", null);    // best run not yet on the board
  var soundOn = load("ng-sound", true);

  if (!window.THREE) {
    ui.authNote.textContent = "The 3D library did not load. Check your connection and reload the page.";
    ui.authNote.className = "note err";
    $("playBtn").disabled = true;
    return;
  }
  var THREE = window.THREE;

  // ---- renderer -----------------------------------------------------------------
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance", alpha: false, stencil: false });
  } catch (e) {
    ui.authNote.textContent = "This browser has WebGL turned off, so the game cannot draw the track.";
    ui.authNote.className = "note err";
    $("playBtn").disabled = true;
    return;
  }
  var maxPR = Math.min(window.devicePixelRatio || 1, 1.5), pr = maxPR;
  var scene = new THREE.Scene();
  var FOG = 0x0b2433;
  scene.fog = new THREE.Fog(FOG, 90, 380);
  var camera = new THREE.PerspectiveCamera(60, 1, 0.3, 900);
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize); resize();
  renderer.setPixelRatio(pr);
  var ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  // Software renderers (no GPU) start one rung down the quality ladder.
  var gpuName = "";
  try { var dbg = renderer.getContext().getExtension("WEBGL_debug_renderer_info"); if (dbg) gpuName = renderer.getContext().getParameter(dbg.UNMASKED_RENDERER_WEBGL) || ""; } catch (e) { /* hidden */ }
  var softGL = /swiftshader|llvmpipe|software|basic render/i.test(gpuName);
  if (softGL) { ANISO = 1; maxPR = Math.min(maxPR, 1); pr = Math.min(pr, 0.8); renderer.setPixelRatio(pr); }
  var quality = softGL ? 1 : 0;   // 0 full, 1 plain texture filtering, 2 no city backdrop

  // ---- textures (drawn once on canvases) ----------------------------------------
  function canvasTex(size, draw, repeat) {
    var c = document.createElement("canvas"); c.width = c.height = size;
    draw(c.getContext("2d"), size);
    var t = new THREE.CanvasTexture(c);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.anisotropy = ANISO;
    return t;
  }
  function grid(line, fill, lw, glow) {
    return canvasTex(128, function (g, n) {
      g.fillStyle = fill; g.fillRect(0, 0, n, n);
      g.strokeStyle = line; g.lineWidth = lw; g.shadowColor = line; g.shadowBlur = glow;
      g.strokeRect(lw / 2, lw / 2, n - lw, n - lw);
      g.shadowBlur = 0; g.strokeRect(lw / 2, lw / 2, n - lw, n - lw);
    }, true);
  }
  var texTrack = grid("#5fe3f5", "#03090f", 6, 14);
  var texSide = grid("#3aa8bd", "#020609", 4, 8);
  var texBlock = grid("#ef7cf4", "#16041a", 6, 14);
  var texCity = grid("#2f9fb6", "#020812", 3, 6);
  var texChev = canvasTex(128, function (g, n) {
    g.clearRect(0, 0, n, n);
    g.fillStyle = "#e9fdff"; g.shadowColor = "#bff6ff"; g.shadowBlur = 10;
    g.beginPath(); g.moveTo(n * 0.5, n * 0.12); g.lineTo(n * 0.95, n * 0.55); g.lineTo(n * 0.95, n * 0.82);
    g.lineTo(n * 0.5, n * 0.4); g.lineTo(n * 0.05, n * 0.82); g.lineTo(n * 0.05, n * 0.55); g.closePath(); g.fill();
  }, true);
  scene.background = canvasTex(256, function (g, n) {
    var l = g.createLinearGradient(0, 0, 0, n);
    l.addColorStop(0, "#050a17"); l.addColorStop(0.42, "#0b2234"); l.addColorStop(0.62, "#11384a"); l.addColorStop(1, "#0a1a26");
    g.fillStyle = l; g.fillRect(0, 0, n, n);
  }, false);

  var CELL = 4, CELL_B = 1.6, CELL_C = 3.2;
  var matTrack = new THREE.MeshBasicMaterial({ map: texTrack });
  var matSide = new THREE.MeshBasicMaterial({ map: texSide });
  var matBlock = new THREE.MeshBasicMaterial({ map: texBlock });
  var matCity = new THREE.MeshBasicMaterial({ map: texCity });
  var matChev = new THREE.MeshBasicMaterial({ map: texChev, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  var matEdge = new THREE.LineBasicMaterial({ color: 0x8ff0ff });
  var matBlockEdge = new THREE.LineBasicMaterial({ color: 0xff9cf6 });
  var matTunnelC = new THREE.LineBasicMaterial({ color: 0x4acbe1 });
  var matTunnelM = new THREE.LineBasicMaterial({ color: 0xde79e7 });

  // ---- geometry -------------------------------------------------------------------
  function Buf() { this.p = []; this.u = []; }
  Buf.prototype.quad = function (a, b, c, d, ua, ub, uc, ud) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    this.u.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1], ua[0], ua[1], uc[0], uc[1], ud[0], ud[1]);
  };
  function meshOf(buf, mat) {
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(buf.p, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(buf.u, 2));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, mat);
  }
  function linesOf(arr, mat) {
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    g.computeBoundingSphere();
    return new THREE.LineSegments(g, mat);
  }
  // Slab whose top follows top(s, x) and bottom sits `th` below; split along s so banked decks twist.
  function slab(top, side, L, O, x0, x1, s0, s1, fn, th, cell, n) {
    var ox = O[0], oy = O[1], os = O[2];
    function P(s, x, dy) { return [x - ox, fn(s, x) - dy - oy, -(s - os)]; }
    for (var i = 0; i < n; i++) {
      var sa = s0 + (s1 - s0) * i / n, sb = s0 + (s1 - s0) * (i + 1) / n;
      var va = (sa - s0) / cell, vb = (sb - s0) / cell, uw = (x1 - x0) / cell;
      top.quad(P(sa, x0, 0), P(sa, x1, 0), P(sb, x1, 0), P(sb, x0, 0), [0, va], [uw, va], [uw, vb], [0, vb]);
      var tv = th / cell;
      side.quad(P(sa, x0, th), P(sb, x0, th), P(sb, x0, 0), P(sa, x0, 0), [va, 0], [vb, 0], [vb, tv], [va, tv]);
      side.quad(P(sb, x1, th), P(sa, x1, th), P(sa, x1, 0), P(sb, x1, 0), [vb, 0], [va, 0], [va, tv], [vb, tv]);
      if (L) {
        var a = P(sa, x0, 0), b = P(sb, x0, 0), c = P(sa, x1, 0), d = P(sb, x1, 0);
        L.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
      }
    }
    var tv2 = th / cell, uw2 = (x1 - x0) / cell;
    side.quad(P(s0, x0, th), P(s0, x1, th), P(s0, x1, 0), P(s0, x0, 0), [0, 0], [uw2, 0], [uw2, tv2], [0, tv2]);
    side.quad(P(s1, x1, th), P(s1, x0, th), P(s1, x0, 0), P(s1, x1, 0), [0, 0], [uw2, 0], [uw2, tv2], [0, tv2]);
    if (L) {
      var e = P(s0, x0, 0), f = P(s0, x1, 0), g = P(s1, x0, 0), h = P(s1, x1, 0);
      L.push(e[0], e[1], e[2], f[0], f[1], f[2], g[0], g[1], g[2], h[0], h[1], h[2]);
    }
  }
  // City tower: only the faces the camera can see from the canyon floor (top, the face toward
  // the track, and the near end), so the backdrop costs little fill.
  function cityBox(buf, O, x0, x1, s0, s1, topY, depth, sideSign) {
    function P(s, x, dy) { return [x - O[0], topY - (s - s0) - dy - O[1], -(s - O[2])]; }
    var L = (s1 - s0) / CELL_C, W = (x1 - x0) / CELL_C, D = depth / CELL_C;
    buf.quad(P(s0, x0, 0), P(s0, x1, 0), P(s1, x1, 0), P(s1, x0, 0), [0, 0], [W, 0], [W, L], [0, L]);
    var xi = sideSign < 0 ? x1 : x0;
    buf.quad(P(s0, xi, depth), P(s1, xi, depth), P(s1, xi, 0), P(s0, xi, 0), [0, 0], [L, 0], [L, D], [0, D]);
    buf.quad(P(s0, x0, depth), P(s0, x1, depth), P(s0, x1, 0), P(s0, x0, 0), [0, 0], [W, 0], [W, D], [0, D]);
  }
  // Hexagonal tunnel ring around the deck at s.
  function ring(arr, O, t, s, w, hgt) {
    var cx = (t.x0 + t.x1) / 2, y = world.h(t, s, cx), r = w / 2 + 1.2;
    var pts = [[-r, -0.2], [-r - 1.6, hgt * 0.5], [-r * 0.55, hgt], [r * 0.55, hgt], [r + 1.6, hgt * 0.5], [r, -0.2]];
    for (var i = 0; i < pts.length - 1; i++) {
      arr.push(cx + pts[i][0] - O[0], y + pts[i][1] - O[1], -(s - O[2]), cx + pts[i + 1][0] - O[0], y + pts[i + 1][1] - O[1], -(s - O[2]));
    }
    return pts;
  }

  // ---- world view: chunks of merged geometry (a handful of draw calls) ------------
  var world, ball, chunks = [], built = { t: 0, o: 0, d: 0, city: -60 }, movers = [];
  var root = new THREE.Group(); scene.add(root);
  var cityRnd = Math.random;

  function hFlat(t) { return function (s, x) { return world.h(t, s, x); }; }
  function buildAhead(sLimit) {
    var tiles = world.tiles, obs = world.obs;
    while (built.t < tiles.length && tiles[built.t].s0 < sLimit) {
      var t0 = tiles[built.t];
      var O = [0, t0.y0, t0.s0];
      var top = new Buf(), side = new Buf(), blk = new Buf(), city = new Buf(), chev = new Buf();
      var L = [], BL = [], TC = [], TM = [], maxS = -1e9;
      var end = Math.min(tiles.length, built.t + 16);
      for (; built.t < end; built.t++) {
        var t = tiles[built.t];
        var n = (t.b0 || t.b1) ? Math.max(2, Math.ceil((t.s1 - t.s0) / 3)) : 1;
        slab(top, side, L, O, t.x0, t.x1, t.s0, t.s1, hFlat(t), NG.THICK, CELL, n);
        if (t.chev) {
          var cx = (t.x0 + t.x1) / 2, hw = 1.6;
          for (var s = t.s0; s < t.s1 - 0.01; s += 3) {
            var se = Math.min(t.s1, s + 3), f = hFlat(t);
            chev.quad([cx - hw - O[0], f(s, cx) + 0.03 - O[1], -(s - O[2])], [cx + hw - O[0], f(s, cx) + 0.03 - O[1], -(s - O[2])],
              [cx + hw - O[0], f(se, cx) + 0.03 - O[1], -(se - O[2])], [cx - hw - O[0], f(se, cx) + 0.03 - O[1], -(se - O[2])],
              [0, 0], [1, 0], [1, (se - s) / 3], [0, (se - s) / 3]);
          }
        }
        if (t.s1 > maxS) maxS = t.s1;
      }
      for (; built.o < obs.length && obs[built.o].s0 < maxS; built.o++) {
        var o = obs[built.o];
        var base = (function (oo) { return function (s, x) { return world.h(oo.t, s, x) + oo.h; }; })(o);
        if (o.amp || o.uamp) {
          var mb = new Buf(), ml = [], MO = [0, world.h(o.t, o.s0, (o.x0 + o.x1) / 2), o.s0];
          slab(mb, mb, ml, MO, o.x0, o.x1, o.s0, o.s1, base, o.h, CELL_B, 1);
          var grp = new THREE.Group();
          grp.add(meshOf(mb, matBlock), linesOf(ml, matBlockEdge));
          grp.userData = { o: o, maxS: o.s1, oy: MO[1], os: MO[2] };
          root.add(grp); movers.push(grp);
        } else {
          slab(blk, blk, BL, O, o.x0, o.x1, o.s0, o.s1, base, o.h, CELL_B, 1);
        }
      }
      for (; built.d < world.deco.length && world.deco[built.d].s0 < maxS; built.d++) {
        var dco = world.deco[built.d], dt = dco.t, w = dt.x1 - dt.x0, prev = null;
        var arr = dco.kind === "tunnel" ? TC : TM, hgt = dco.kind === "tunnel" ? 7 : 5;
        for (var s2 = dco.s0; s2 <= dco.s1 + 0.01; s2 += 5) {
          var pts = ring(arr, O, dt, s2, w, hgt);
          var cxx = (dt.x0 + dt.x1) / 2, yy = world.h(dt, s2, cxx);
          if (prev) for (var k = 0; k < pts.length; k++) {
            TM.push(cxx + pts[k][0] - O[0], yy + pts[k][1] - O[1], -(s2 - O[2]), prev.cx + pts[k][0] - O[0], prev.y + pts[k][1] - O[1], -(prev.s - O[2]));
          }
          prev = { cx: cxx, y: yy, s: s2 };
        }
      }
      // Wireframe city: tall grid-textured towers lining both sides of the canyon.
      while (built.city < maxS) {
        var sc = built.city, tl = null;
        var near = world.tilesAt(sc);
        for (var q = 0; q < near.length; q++) if (sc >= near[q].s0 && sc <= near[q].s1) { tl = near[q]; break; }
        var yc = tl ? world.h(tl, sc, tl.xc) : world.c.y, xc = tl ? tl.xc : world.c.cx;
        var len = 18 + cityRnd() * 26;
        for (var sideSign = -1; sideSign <= 1; sideSign += 2) {
          var gapX = 14 + cityRnd() * 16, wid = 8 + cityRnd() * 18;
          var xa = xc + sideSign * gapX, xb = xa + sideSign * wid;
          var topY = yc + 4 + cityRnd() * 34;
          var bx0 = Math.min(xa, xb), bx1 = Math.max(xa, xb);
          cityBox(city, O, bx0, bx1, sc, sc + len, topY, 60, sideSign);
        }
        built.city += len + cityRnd() * 6;
      }
      var ch = new THREE.Group(); ch.position.set(O[0], O[1], -O[2]); ch.userData.maxS = maxS;
      ch.add(meshOf(top, matTrack), meshOf(side, matSide), linesOf(L, matEdge));
      if (blk.p.length) ch.add(meshOf(blk, matBlock), linesOf(BL, matBlockEdge));
      if (city.p.length) ch.add(meshOf(city, matCity));
      if (chev.p.length) ch.add(meshOf(chev, matChev));
      if (TC.length) ch.add(linesOf(TC, matTunnelC));
      if (TM.length) ch.add(linesOf(TM, matTunnelM));
      root.add(ch); chunks.push(ch);
    }
  }
  function disposeGroup(g) { g.traverse(function (n) { if (n.geometry) n.geometry.dispose(); }); root.remove(g); }
  function cullBehind(s) {
    while (chunks.length && chunks[0].userData.maxS < s - 40) disposeGroup(chunks.shift());
    for (var i = movers.length - 1; i >= 0; i--) if (movers[i].userData.maxS < s - 40) { disposeGroup(movers[i]); movers.splice(i, 1); }
  }
  function clearTrack() {
    chunks.forEach(disposeGroup); movers.forEach(disposeGroup);
    chunks = []; movers = []; built = { t: 0, o: 0, d: 0, city: -60 };
  }

  // ---- ball, glow, trail, shatter, stars --------------------------------------------
  var ballGroup = new THREE.Group(), spin = new THREE.Group();
  spin.add(new THREE.Mesh(new THREE.SphereGeometry(NG.R, 24, 16), new THREE.MeshBasicMaterial({ color: 0x0c2230 })));
  var circ = [];
  for (var c = 0; c < 3; c++) {
    for (var i = 0; i < 48; i++) {
      var a0 = i / 48 * Math.PI * 2, a1 = (i + 1) / 48 * Math.PI * 2, r = NG.R * 1.01;
      var p0 = [Math.cos(a0) * r, Math.sin(a0) * r, 0], p1 = [Math.cos(a1) * r, Math.sin(a1) * r, 0];
      function rot(p) { return c === 0 ? p : c === 1 ? [p[2], p[1], p[0]] : [p[0], p[2], p[1]]; }
      circ.push.apply(circ, rot(p0).concat(rot(p1)));
    }
  }
  spin.add(linesOf(circ, new THREE.LineBasicMaterial({ color: 0xe8fdff })));
  ballGroup.add(spin);
  scene.add(ballGroup);

  // Trail: a short ribbon behind the ball that fades from cyan to nothing.
  var TRAIL = 18, trailPts = [], trailPos = new Float32Array(TRAIL * 2 * 3), trailCol = new Float32Array(TRAIL * 2 * 3), trailIdx = [];
  for (var ti = 0; ti < TRAIL; ti++) {
    var f = Math.pow(1 - ti / TRAIL, 1.6);
    for (var e2 = 0; e2 < 2; e2++) { var o3 = (ti * 2 + e2) * 3; trailCol[o3] = 0.41 * f; trailCol[o3 + 1] = 1 * f; trailCol[o3 + 2] = 1 * f; }
    if (ti < TRAIL - 1) { var a = ti * 2; trailIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  var trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute("color", new THREE.BufferAttribute(trailCol, 3));
  trailGeo.setIndex(trailIdx);
  var trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  trail.frustumCulled = false; scene.add(trail);
  function resetTrail() { trailPts = []; for (var i = 0; i < TRAIL; i++) trailPts.push([ball.x, ball.by + 0.12, -ball.s]); writeTrail(); }
  function writeTrail() {
    for (var i = 0; i < TRAIL; i++) {
      var p = trailPts[i], hw = 0.32 * (1 - i / TRAIL), o = i * 6;
      trailPos[o] = p[0] - hw; trailPos[o + 1] = p[1]; trailPos[o + 2] = p[2];
      trailPos[o + 3] = p[0] + hw; trailPos[o + 4] = p[1]; trailPos[o + 5] = p[2];
    }
    trailGeo.attributes.position.needsUpdate = true;
  }

  var SHARDS = 23, shards = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), new THREE.MeshBasicMaterial({ color: 0xde79e7 }), SHARDS);
  shards.visible = false; shards.frustumCulled = false; scene.add(shards);
  var shardV = [], shardP = [], shardAge = 0, tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  function shatter(x, y, z) {
    shards.visible = true; shardAge = 0; shardV = []; shardP = [];
    for (var i = 0; i < SHARDS; i++) {
      var th = Math.random() * Math.PI * 2, sp = 5 + Math.random() * 9;
      shardV.push([Math.cos(th) * sp, 3 + Math.random() * 8, Math.sin(th) * sp]);
      shardP.push([x, y, z, Math.random() * 6]);
    }
  }
  function updateShards(dt) {
    if (!shards.visible) return;
    shardAge += dt;
    for (var i = 0; i < SHARDS; i++) {
      var v = shardV[i], p = shardP[i];
      v[1] -= 20 * dt; p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt; p[3] += dt * 6;
      tmpQ.setFromEuler(tmpE.set(p[3], p[3] * 0.7, 0));
      var sc = Math.max(0.01, 1 - shardAge / 2.2);
      tmpM.compose(new THREE.Vector3(p[0], p[1], p[2]), tmpQ, one.clone().multiplyScalar(sc));
      shards.setMatrixAt(i, tmpM);
    }
    shards.instanceMatrix.needsUpdate = true;
    if (shardAge > 2.2) shards.visible = false;
  }

  var starGeo = new THREE.BufferGeometry(), sp = [];
  for (var si = 0; si < 500; si++) {
    var az = Math.random() * Math.PI * 2, el = Math.random() * 1.2 - 0.1, rr = 700;
    sp.push(Math.cos(az) * Math.cos(el) * rr, Math.sin(el) * rr, Math.sin(az) * Math.cos(el) * rr);
  }
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  var stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9fc8d8, size: 1.5, sizeAttenuation: false, fog: false }));
  scene.add(stars);

  // ---- audio: a small synth so there are no audio files to load ----------------------
  var audio = (function () {
    var ctx = null, master = null, musicGain = null, timer = null, nextT = 0, stepN = 0;
    var BPM = 118, STEP = 60 / BPM / 4;
    var BASS = [45, 45, 57, 45, 41, 41, 53, 41, 48, 48, 60, 48, 43, 43, 55, 43];
    var ARP = [69, 72, 76, 72, 65, 69, 72, 69, 67, 72, 76, 72, 67, 71, 74, 71];
    function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
    function ensure() {
      if (ctx) return ctx;
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = soundOn ? 0.5 : 0; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.55; musicGain.connect(master);
      return ctx;
    }
    function tone(type, f, t, dur, vol, dest, f2) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(t, dur, vol, hp) {
      var len = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      var s = ctx.createBufferSource(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
      fl.type = "highpass"; fl.frequency.value = hp || 6000;
      s.buffer = b; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(fl); fl.connect(g); g.connect(musicGain); s.start(t);
    }
    function schedule() {
      while (nextT < ctx.currentTime + 0.25) {
        var i = stepN % 16, bar = Math.floor(stepN / 16) % 4;
        if (i % 4 === 0) tone("sine", 120, nextT, 0.22, 0.9, musicGain, 40);
        if (i % 4 === 2) noise(nextT, 0.05, 0.25);
        tone("sawtooth", hz(BASS[bar * 4 + Math.floor(i / 4)] - 12), nextT, STEP * 0.9, 0.16, musicGain);
        if (stepN % 2 === 0) tone("square", hz(ARP[(bar * 4 + i / 2) % 16 | 0]), nextT, STEP * 1.6, 0.045, musicGain);
        nextT += STEP; stepN++;
      }
    }
    return {
      unlock: function () { if (ensure() && ctx.state === "suspended") ctx.resume(); },
      music: function (on) {
        if (!ensure()) return;
        if (on && !timer) { nextT = ctx.currentTime + 0.08; stepN = 0; timer = setInterval(schedule, 60); schedule(); }
        if (!on && timer) { clearInterval(timer); timer = null; }
      },
      setOn: function (on) { if (ensure()) master.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, 0.02); },
      sfx: function (kind) {
        if (!ensure() || !soundOn) return;
        var t = ctx.currentTime;
        if (kind === "speed") { tone("sawtooth", 300, t, 0.5, 0.18, master, 1400); tone("sine", 600, t + 0.05, 0.4, 0.12, master, 2000); }
        if (kind === "die") { tone("square", 220, t, 0.45, 0.25, master, 40); tone("sine", 90, t, 0.4, 0.5, master, 30); }
        if (kind === "fall") { tone("triangle", 660, t, 1.1, 0.25, master, 70); }
      }
    };
  })();
  function renderSound() {
    ui.sound.setAttribute("aria-pressed", String(soundOn));
    ui.sound.setAttribute("aria-label", soundOn ? "Sound on" : "Sound off");
    $("soundWaves").style.display = soundOn ? "" : "none";
    $("soundOff").hidden = soundOn;
  }
  ui.sound.addEventListener("click", function () { soundOn = !soundOn; save("ng-sound", soundOn); audio.unlock(); audio.setOn(soundOn); renderSound(); });
  renderSound();

  // ---- input -------------------------------------------------------------------------
  var keys = { l: false, r: false }, touches = new Map();
  function input() {
    var l = keys.l, r = keys.r;
    touches.forEach(function (side) { if (side < 0) l = true; else r = true; });
    ui.arrowL.classList.toggle("on", l); ui.arrowR.classList.toggle("on", r);
    return (r ? 1 : 0) - (l ? 1 : 0);
  }
  function keyDir(e) {
    var k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") return "l";
    if (k === "ArrowRight" || k === "d" || k === "D") return "r";
    return null;
  }
  function typing(e) { return e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA"); }
  window.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
    var d = keyDir(e);
    if (d) { if (state === "play") e.preventDefault(); keys[d] = true; return; }
    if (e.key === " " || e.key === "Enter") {
      if (e.target && e.target.tagName === "BUTTON" && e.key === "Enter") return;
      if (e.repeat) return;
      if (state === "menu") { e.preventDefault(); startRun(); }
      else if (state === "over" && !ui.over.hidden) { e.preventDefault(); startRun(); }
      else if (state === "pause") { e.preventDefault(); resume(); }
      return;
    }
    if (e.key === "p" || e.key === "P" || e.key === "Escape") {
      if (state === "play") pause(); else if (state === "pause") resume();
      else if (state === "board" && e.key === "Escape") showMenu();
    }
  });
  window.addEventListener("keyup", function (e) {
    if (e.key === "Meta" || e.key === "Control" || e.key === "Alt") { keys.l = keys.r = false; return; }
    var d = keyDir(e); if (d) keys[d] = false;
  });
  window.addEventListener("blur", function () { keys.l = keys.r = false; touches.clear(); if (state === "play") pause(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden && state === "play") pause(); });
  function sideOf(e) { return e.clientX < window.innerWidth / 2 ? -1 : 1; }
  function down(e) {
    if (state !== "play") return;
    if (e.pointerType === "mouse" && e.target === canvas) return;   // desktop steers with keys
    touches.set(e.pointerId, sideOf(e));
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    e.preventDefault();
  }
  [canvas, ui.arrowL, ui.arrowR].forEach(function (el) {
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", function (e) { if (touches.has(e.pointerId)) touches.set(e.pointerId, sideOf(e)); });
    el.addEventListener("pointerup", function (e) { touches.delete(e.pointerId); });
    el.addEventListener("pointercancel", function (e) { touches.delete(e.pointerId); });
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  });

  // ---- game flow -----------------------------------------------------------------------
  var state = "menu", acc = 0, hintTimer = 0, speedTimer = 0, fovKick = 0, landPulse = 0, shownScore = -1, overTimer = 0;
  var camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camFrozen = null, runSeed = 0;

  function newWorld() {
    clearTrack();
    runSeed = (Math.random() * 4294967296) >>> 0;
    world = new NG.World(runSeed);
    ball = new NG.Ball(world);
    world.ensure(900);
    buildAhead(ball.s + 340);
    acc = 0; camFrozen = null; shards.visible = false; ballGroup.visible = true; fovEvt = null; touched = false; boostSeen = 0;
    resetTrail(); placeCamera(true, 0);
  }
  function setPlaying(on) {
    document.body.classList.toggle("playing", on);
    ui.score.hidden = !on; ui.pauseBtn.hidden = !on;
    ui.arrowL.hidden = ui.arrowR.hidden = !on;
  }
  function showOnly(el) {
    [ui.menu, ui.board, ui.over, ui.paused].forEach(function (x) { x.hidden = x !== el; });
  }
  function showMenu() {
    state = "menu"; setPlaying(false); showOnly(ui.menu); audio.music(false);
    clearTimeout(overTimer);
  }
  function startRun() {
    audio.unlock();
    clearTimeout(overTimer);
    newWorld();
    state = "play"; setPlaying(true); showOnly(null);
    shownScore = -1; keys.l = keys.r = false; touches.clear();
    ui.hint.hidden = false; ui.hint.style.opacity = "1";
    clearTimeout(hintTimer); hintTimer = setTimeout(function () { ui.hint.style.opacity = "0"; }, 2600);
    audio.music(soundOn);
    canvas.focus({ preventScroll: true });
    last = performance.now();
  }
  function pause() { state = "pause"; showOnly(ui.paused); audio.music(false); $("resumeBtn").focus({ preventScroll: true }); }
  function resume() { state = "play"; showOnly(null); audio.music(soundOn); last = performance.now(); canvas.focus({ preventScroll: true }); }
  function runRecord() {
    return { score: ball.score, dist: Math.floor(ball.s), t: +ball.t.toFixed(2), seed: runSeed };
  }
  function gameOver() {
    state = "over";
    audio.music(false); audio.sfx(ball.cause === "fall" ? "fall" : "die");
    ui.speedup.classList.remove("on");
    var run = runRecord(), isBest = !best || run.score > best.score;
    if (isBest && run.score > 0) { best = run; save("ng-best", best); }
    ui.finalScore.textContent = run.score;
    ui.finalScore.classList.toggle("new", isBest && run.score > 0);
    ui.finalBest.textContent = best ? best.score : 0;
    ui.postStatus.textContent = ""; ui.postStatus.className = "status";
    maybePost(run);
    overTimer = setTimeout(function () {
      if (state !== "over") return;
      setPlaying(false); showOnly(ui.over); $("againBtn").focus({ preventScroll: true });
    }, 1000);
  }

  $("playBtn").addEventListener("click", startRun);
  $("againBtn").addEventListener("click", startRun);
  $("menuBtn").addEventListener("click", showMenu);
  $("quitBtn").addEventListener("click", showMenu);
  $("resumeBtn").addEventListener("click", resume);
  ui.pauseBtn.addEventListener("click", function () { if (state === "play") pause(); });

  // ---- camera: about 6 m up and 4 m back, pitched 45 degrees to look straight down the slope ---
  var PITCH = 45.2 * Math.PI / 180, CAM_UP = 6.07, CAM_BACK = 4.04;
  // Field of view, timed like the original: a first-touch pulse to 70, and on each speed-up a snap
  // to 75 in 0.15 s, held while "speed up" shows (1.6 s), then a 6 s ease back to 60.
  var fovEvt = null, touched = false;
  function lerp(a, b, t) { return a + (b - a) * Math.min(1, Math.max(0, t)); }
  function fovNow() {
    if (!fovEvt) return 60;
    var d = ball.t - fovEvt.t0;
    if (fovEvt.kind === "start") {
      if (d < 0.3) return lerp(60, 70, d / 0.3);
      if (d < 0.7) return 70;
      var u = Math.min(1, (d - 0.7) / 0.4); return lerp(70, 60, Math.sqrt(1 - (u - 1) * (u - 1)));
    }
    if (d < 0.15) return lerp(fovEvt.from, 75, d / 0.15);
    if (d < 1.6) return 75;
    return lerp(75, 60, (d - 1.6) / 6);
  }
  function placeCamera(snap, dt) {
    var bx = ball.x, by = ball.by + NG.R, bs = ball.s;
    var ty = by + CAM_UP, tz = -(bs - CAM_BACK);
    if (ball.dead && ball.cause === "fall") { if (camFrozen === null) camFrozen = camPos.clone(); }
    if (camFrozen) { camPos.copy(camFrozen); }
    else if (snap) camPos.set(bx, ty, tz);
    else {
      camPos.x += (bx - camPos.x) * (1 - Math.exp(-14 * dt));
      camPos.y += (ty - camPos.y) * (1 - Math.exp(-12 * dt));
      camPos.z = ball.dead ? camPos.z : tz;
    }
    camera.position.copy(camPos);
    if (camFrozen) camLook.lerp(new THREE.Vector3(bx, by, -bs), 1 - Math.exp(-6 * dt));
    else camLook.set(camPos.x, camPos.y - Math.sin(PITCH) * 10, camPos.z - Math.cos(PITCH) * 10);
    camera.lookAt(camLook);
    var fov = fovNow();
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
    stars.position.copy(camPos);
  }

  // ---- frame loop ---------------------------------------------------------------------------
  var last = performance.now(), frames = 0, frameAcc = 0, slow = 0, fast = 0, boostSeen = 0;
  function adaptQuality(dt) {
    if (state !== "play") return;
    frames++; frameAcc += dt;
    if (frameAcc < 0.75) return;
    var avg = frameAcc / frames; frames = 0; frameAcc = 0;
    if (avg > 0.021) { slow++; fast = 0; } else if (avg < 0.0175) { fast++; slow = 0; } else { slow = fast = 0; }
    var next = pr;
    if (slow >= 1 && pr > 0.55) next = Math.max(0.55, pr * 0.82);
    else if (slow >= 2 && quality < 2) { setQuality(quality + 1); slow = 0; }
    if (fast >= 4 && pr < maxPR) next = Math.min(maxPR, pr * 1.12);
    if (next !== pr) { pr = next; renderer.setPixelRatio(pr); resize(); slow = fast = 0; }
  }
  function setQuality(q) {
    quality = q;
    var a = q >= 1 ? 1 : ANISO;
    [texTrack, texSide, texBlock, texCity].forEach(function (t) { t.anisotropy = a; t.needsUpdate = true; });
    matCity.visible = q < 2;
  }
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    if (state === "play") {
      acc += dt;
      var inp = input(), steps = 0;
      while (acc >= NG.DT && steps < 40) { NG.step(world, ball, inp); acc -= NG.DT; steps++; if (ball.dead) break; }
      if (ball.boosted > boostSeen) {
        boostSeen = ball.boosted; fovEvt = { kind: "boost", t0: ball.t, from: camera.fov }; audio.sfx("speed");
        ui.speedup.classList.add("on"); clearTimeout(speedTimer);
        speedTimer = setTimeout(function () { ui.speedup.classList.remove("on"); }, 1600);
      }
      if (!touched && ball.ground) { touched = true; fovEvt = { kind: "start", t0: ball.t }; }
      if (ball.score !== shownScore) { shownScore = ball.score; ui.score.textContent = shownScore; }
      if (ball.dead) {
        acc = 0;
        if (ball.cause !== "fall") { shatter(ball.x, ball.by + NG.R, -ball.s); ballGroup.visible = false; }
        gameOver();
      }
    } else if (state === "over" && ball.cause === "fall") {
      ball.vy -= NG.GRAV * dt; ball.by += ball.vy * dt; ball.x += ball.vx * dt; ball.s += ball.vs * dt * 0.5;
    }
    if (state === "menu" || state === "board") {
      // attract mode: the camera drifts down the start of a fresh track behind the menu
      if (!ball.dead) { ball.t += dt; }
    }

    var by = ball.by + NG.R;
    if (ball.landed > 0) { landPulse = ball.landed; ball.landed = 0; }
    landPulse = Math.max(0, landPulse - dt * 5);
    ballGroup.position.set(ball.x, by - landPulse * 0.08, -ball.s);
    spin.scale.set(1 + landPulse * 0.14, 1 - landPulse * 0.18, 1 + landPulse * 0.14);
    if (state === "play") { spin.rotation.x -= (ball.vs * 1.41 * dt) / NG.R; spin.rotation.z -= (ball.vx * dt) / NG.R * 0.6; }
    if (state === "play" || (state === "over" && ball.cause === "fall")) {
      trailPts.pop(); trailPts.unshift([ball.x, ball.by + 0.12, -ball.s]); writeTrail();
    }
    trail.visible = ballGroup.visible;

    for (var m = 0; m < movers.length; m++) {
      var u = movers[m].userData;
      movers[m].position.set(NG.obsOffset(u.o, ball.t), u.oy + NG.obsLift(u.o, ball.t), -u.os);
    }
    updateShards(dt);
    if (state !== "pause") placeCamera(false, dt);
    buildAhead(ball.s + 340);
    cullBehind(camFrozen ? -camFrozen.z + CAM_BACK : ball.s);
    renderer.render(scene, camera);
    adaptQuality(dt);
  }

  // ---- scores on Bluesky --------------------------------------------------------------------
  var scores = null;
  function accept(v) {
    // A run's score must be consistent with its own distance and time. Not proof, but it drops nonsense.
    if (!Number.isInteger(v.value) || v.value < 0 || v.value > 20000) return false;
    var m = /dist=(\d+)\b.*\bt=([\d.]+)/.exec(v.detail || "");
    if (!m) return false;
    var dist = +m[1], t = +m[2];
    if (!(t > 0) || dist > t * NG.VMAX * 1.08 + 30) return false;
    return v.value <= dist / 20 + 3;
  }
  function detailOf(run) { return "seed=" + run.seed + " dist=" + run.dist + " t=" + run.t + " v=" + VERSION; }
  function postedBest() { return scores && scores.did ? load("ng-posted:" + scores.did, 0) : 0; }
  function setStatus(text, cls, retry) {
    ui.postStatus.textContent = text; ui.postStatus.className = "status" + (cls ? " " + cls : "");
    if (retry) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = "Try again";
      b.addEventListener("click", retry); ui.postStatus.append(" ", b);
    }
  }
  function postRun(run, onDone) {
    scores.post({ value: run.score, detail: detailOf(run) }).then(function () {
      save("ng-posted:" + scores.did, run.score);
      if (pending && pending.score <= run.score) { pending = null; save("ng-pending", null); }
      onDone(null);
    }, function (err) { onDone(err); });
  }
  function maybePost(run) {
    if (run.score <= 0) return;
    if (scores && scores.did) {
      if (run.score <= postedBest()) return;
      setStatus("Posting to the leaderboard…");
      var attempt = function () {
        setStatus("Posting to the leaderboard…");
        postRun(run, function (err) {
          if (err) setStatus("Couldn't post: " + err.message, "err", attempt);
          else setStatus("New best posted to the leaderboard.", "ok");
        });
      };
      attempt();
    } else if (!pending || run.score > pending.score) {
      if (best && best.score === run.score) { pending = run; save("ng-pending", pending); }
      if (scores && scores.enabled) setStatus("Sign in on the menu to post this score.");
    }
  }
  function renderAuth() {
    var on = !!(scores && scores.did);
    ui.signedOut.hidden = on; ui.signedIn.hidden = !on;
    if (on) ui.whoHandle.textContent = "@" + (scores.handle || scores.did);
  }
  function note(text, err) { ui.authNote.textContent = text || ""; ui.authNote.className = "note" + (err ? " err" : ""); }
  function startScores() {
    scores = window.NGScores({ site: SITE, game: GAME, accept: accept });
    if (!scores.enabled) {
      ui.handle.disabled = true; $("signInBtn").disabled = true;
      note("Sign-in works on joshuashew.com.");
      return;
    }
    scores.init().then(function (r) {
      renderAuth();
      if (r.did && pending && pending.score > postedBest()) {
        note("Posting your best score…");
        postRun(pending, function (err) { note(err ? "Couldn't post your best score: " + err.message : "Posted your best score: " + (best ? best.score : ""), !!err); });
      }
    }, function (err) { note("Bluesky sign-in is unavailable right now (" + err.message + ").", true); });
  }
  function doSignIn() {
    if (!scores || !scores.enabled) return;
    note("Opening Bluesky…");
    scores.signIn(ui.handle.value).catch(function (err) { note(err.message, true); });
  }
  $("signInBtn").addEventListener("click", doSignIn);
  ui.handle.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); doSignIn(); } });
  $("signOutBtn").addEventListener("click", function () { scores.signOut().then(function () { renderAuth(); note(""); }); });
  if (window.NGScores) startScores(); else window.addEventListener("ng-scores-ready", startScores, { once: true });

  var boardCache = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function renderBoard(rows) {
    ui.boardRows.innerHTML = "";
    var me = scores && scores.did;
    rows.slice(0, 100).forEach(function (r, i) {
      var li = document.createElement("li"); if (r.did === me) li.className = "me";
      li.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="h"><a href="https://bsky.app/profile/' + esc(r.did) + '" target="_blank" rel="noopener">@' + esc(r.handle) + '</a></span><span class="v">' + r.value + "</span>";
      ui.boardRows.appendChild(li);
    });
    ui.boardNote.textContent = rows.length ? "" : "No scores yet. Sign in and finish a run to post the first one.";
  }
  function loadBoard(force) {
    if (!scores) { ui.boardNote.textContent = "Loading…"; return; }
    if (boardCache && !force && Date.now() - boardCache.at < 60000) { renderBoard(boardCache.rows); return; }
    ui.boardNote.textContent = "Loading scores from Bluesky…"; ui.boardRows.innerHTML = "";
    scores.board().then(function (rows) { boardCache = { at: Date.now(), rows: rows }; if (state === "board") renderBoard(rows); },
      function (err) { ui.boardNote.textContent = "Couldn't load the leaderboard: " + err.message; });
  }
  $("boardBtn").addEventListener("click", function () { state = "board"; showOnly(ui.board); loadBoard(false); });
  $("boardRefresh").addEventListener("click", function () { loadBoard(true); });
  $("boardBack").addEventListener("click", showMenu);

  // ---- boot -----------------------------------------------------------------------------------
  newWorld();
  showMenu();
  requestAnimationFrame(frame);
  window.__ng = {
    get state() { return state; }, get ball() { return ball; }, get world() { return world; },
    get pixelRatio() { return pr; }, get drawCalls() { return renderer.info.render.calls; },
    get geometries() { return renderer.info.memory.geometries; }, get quality() { return quality; }, gpu: gpuName,
    start: startRun, keys: keys, accept: accept,
    mats: { track: matTrack, side: matSide, block: matBlock, city: matCity }, tex: [texTrack, texSide, texBlock, texCity], renderer: renderer
  };
})();
