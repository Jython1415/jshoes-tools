/* Slope 3 Remake: renderer, camera, audio, input, game flow and Bluesky scores.
   Physics is in phys.js / ball.js / world.js and runs in Unity coordinates (z forward);
   three.js looks down -z, so every point is drawn at (x, y, -z). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var SITE = "slope-3-remake", GAME = "run-v1", VERSION = "1.0";
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

  function load(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  var best = load("s3r-best", null), pending = load("s3r-pending", null), soundOn = load("s3r-sound", true);

  function fail(msg) { ui.authNote.textContent = msg; ui.authNote.className = "note err"; $("playBtn").disabled = true; }
  if (!window.THREE) return fail("The 3D library did not load. Check your connection and reload the page.");
  var THREE = window.THREE, P = window.S3P, W = window.S3W, B = window.S3B, CFG = window.S3CFG;

  // ---- renderer ---------------------------------------------------------------------------------
  var renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance", alpha: false, stencil: false }); }
  catch (e) { return fail("This browser has WebGL turned off, so the game cannot draw the track."); }
  var maxPR = Math.min(window.devicePixelRatio || 1, 1.5), pr = maxPR;
  var gpuName = "";
  try { var dbg = renderer.getContext().getExtension("WEBGL_debug_renderer_info"); if (dbg) gpuName = renderer.getContext().getParameter(dbg.UNMASKED_RENDERER_WEBGL) || ""; } catch (e) { /* hidden */ }
  var softGL = /swiftshader|llvmpipe|software|basic render/i.test(gpuName);
  var ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (softGL) { ANISO = 1; maxPR = Math.min(maxPR, 1); pr = Math.min(pr, 0.8); }
  renderer.setPixelRatio(pr);
  var quality = softGL ? 1 : 0;   // 0 full, 1 plain texture filtering, 2 no city backdrop
  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b2433, 260, 900);
  var camera = new THREE.PerspectiveCamera(60, 1, 0.3, 2000);
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize); resize();

  // ---- textures, at the original's proportions: a 32-texel tile with a 2-texel border, smoothly
  //      filtered, line colour = the original's texture colour times its overbright glow colour ------
  function canvasTex(size, draw, repeat) {
    var c = document.createElement("canvas"); c.width = c.height = size;
    draw(c.getContext("2d"), size);
    var t = new THREE.CanvasTexture(c);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = ANISO;
    return t;
  }
  function tile(core, halo, fill) {
    return canvasTex(64, function (g, n) {
      var bw = n * 1 / 32;   // the gameplay footage shows half the texture file's 2-texel border
      g.fillStyle = fill; g.fillRect(0, 0, n, n);
      g.fillStyle = halo; g.globalAlpha = 0.28;               // a little of the original's bloom, baked in
      g.fillRect(0, 0, n, bw * 2.2); g.fillRect(0, n - bw * 2.2, n, bw * 2.2); g.fillRect(0, 0, bw * 2.2, n); g.fillRect(n - bw * 2.2, 0, bw * 2.2, n);
      g.globalAlpha = 1; g.fillStyle = core;
      g.fillRect(0, 0, n, bw); g.fillRect(0, n - bw, n, bw); g.fillRect(0, 0, bw, n); g.fillRect(n - bw, 0, bw, n);
    }, true);
  }
  var texGround = tile("#9af2ff", "#2fb8d6", "#020609");
  var texPeril = tile("#ff9cf7", "#d660e0", "#06020a");
  var texPerilThin = texPeril;
  var texCity = tile("#4fc3dc", "#1d7f96", "#010409");
  var texArrows = canvasTex(64, function (g, n) {          // a thick V, point toward the bottom, as in the original
    g.fillStyle = "#020609"; g.fillRect(0, 0, n, n);
    g.fillStyle = "#9af2ff";
    g.beginPath(); g.moveTo(n * 0.06, n * 0.12); g.lineTo(n * 0.3, n * 0.12); g.lineTo(n * 0.5, n * 0.5); g.lineTo(n * 0.7, n * 0.12);
    g.lineTo(n * 0.94, n * 0.12); g.lineTo(n * 0.5, n * 0.88); g.closePath(); g.fill();
  }, true);
  scene.background = canvasTex(256, function (g, n) {
    var l = g.createLinearGradient(0, 0, 0, n);
    l.addColorStop(0, "#050a17"); l.addColorStop(0.42, "#0b2234"); l.addColorStop(0.62, "#11384a"); l.addColorStop(1, "#0a1a26");
    g.fillStyle = l; g.fillRect(0, 0, n, n);
  }, false);
  var MATS = {
    Ground: new THREE.MeshBasicMaterial({ map: texGround }),
    GroundArrows: new THREE.MeshBasicMaterial({ map: texArrows }),
    Peril: new THREE.MeshBasicMaterial({ map: texPeril }),
    PerilThin: new THREE.MeshBasicMaterial({ map: texPerilThin }),
    City: new THREE.MeshBasicMaterial({ map: texCity })
  };
  var ALL_TEX = [texGround, texPeril, texPerilThin, texCity, texArrows];

  // ---- geometry from the measured collision meshes ----------------------------------------------
  // UVs: project each triangle on its own plane. Surfaces that face up the 45-degree slope get one
  // tile per 10 m across and per 14.14 m down the slope, so the grid lines sit on the deck seams.
  var SQ2 = Math.SQRT1_2;
  function uvFor(p, n, mat) {
    var ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    var cell = mat === "PerilThin" ? 10 : mat === "Peril" ? 2.5 : 10;
    if (ax < 0.5 && ay > 0.3 && az > 0.3 && n[1] * n[2] > 0) return [p[0] / 10, (p[2] - p[1]) * SQ2 / 14.142];   // deck
    if (ax >= ay && ax >= az) return [p[2] / cell, p[1] / cell];
    if (ay >= az) return [p[0] / cell, p[2] / cell];
    return [p[0] / cell, p[1] / cell];
  }
  function Acc() { this.p = []; this.u = []; }
  Acc.prototype.tri = function (a, b, c, n, mat, o, uvs) {
    var pts = [a, b, c];
    for (var i = 0; i < 3; i++) {
      var q = pts[i], uv = uvs ? uvs[i] : uvFor(q, n, mat);
      this.p.push(q[0] + o[0], q[1] + o[1], -(q[2] + o[2]));   // flip z for three.js (also flips winding)
      this.u.push(uv[0], uv[1]);
    }
  };
  function meshOf(acc, mat) {
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(acc.p, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(acc.u, 2));
    g.computeBoundingSphere();
    var m = new THREE.Mesh(g, mat); m.material.side = THREE.DoubleSide;
    return m;
  }

  var world, ball, groups = [], builtBlocks = 0, movers = [], rnd = Math.random;
  var root = new THREE.Group(); scene.add(root);
  function buildBlocks() {
    while (builtBlocks < world.placed.length) {
      var blk = world.placed[builtBlocks++], o = blk.origin, accs = {};
      var grp = new THREE.Group(); grp.userData.along = W.along(o);
      blk.cols.forEach(function (col) {
        if (col.mat === "invisible") return;
        var mat = MATS[col.mat] ? col.mat : (col.death ? "Peril" : "Ground");
        if (col.mover) {   // moving obstacles get their own mesh so they can slide
          var acc1 = new Acc(), z = [0, 0, 0];
          col.src.tris.forEach(function (t) { acc1.tri(t.a, t.b, t.c, t.n, mat, z, t.uv); });
          var m = meshOf(acc1, MATS[mat]); m.userData.col = col;
          grp.add(m); movers.push(m);
          return;
        }
        var off = P.sub(col.origin, o), acc = accs[mat] || (accs[mat] = new Acc());
        col.src.tris.forEach(function (t) { acc.tri(t.a, t.b, t.c, t.n, mat, off, t.uv); });
      });
      for (var k in accs) grp.add(meshOf(accs[k], MATS[k]));
      // wireframe-city towers beside the canyon, like the original's backdrop
      var city = new Acc(), span = Math.max(40, (blk.spec.name === "5 Obstacle" ? 230 : 120));
      for (var s = 0; s < span; s += 22 + rnd() * 18) {
        for (var side = -1; side <= 1; side += 2) {
          var x0 = 5 + side * (38 + rnd() * 40), w = 10 + rnd() * 18, top = 10 + rnd() * 45, d = 18 + rnd() * 20;
          var z0 = s * SQ2, y0 = -s * SQ2 + top;
          box(city, [Math.min(x0, x0 + side * w), y0 - 160, z0], [Math.max(x0, x0 + side * w), y0, z0 + d]);
        }
      }
      if (city.p.length) { var cm = meshOf(city, MATS.City); cm.userData.city = true; grp.add(cm); }
      grp.position.set(o[0], o[1], -o[2]);
      root.add(grp); groups.push(grp);
    }
  }
  function box(acc, lo, hi) {
    var X = [lo[0], hi[0]], Y = [lo[1], hi[1]], Z = [lo[2], hi[2]];
    function q(a, b, c, d, n) { acc.tri(a, b, c, n, "City", [0, 0, 0]); acc.tri(a, c, d, n, "City", [0, 0, 0]); }
    q([X[0], Y[1], Z[0]], [X[1], Y[1], Z[0]], [X[1], Y[1], Z[1]], [X[0], Y[1], Z[1]], [0, 1, 0]);
    q([X[0], Y[0], Z[0]], [X[1], Y[0], Z[0]], [X[1], Y[1], Z[0]], [X[0], Y[1], Z[0]], [0, 0, -1]);
    q([X[0], Y[0], Z[0]], [X[0], Y[1], Z[0]], [X[0], Y[1], Z[1]], [X[0], Y[0], Z[1]], [-1, 0, 0]);
    q([X[1], Y[0], Z[0]], [X[1], Y[1], Z[0]], [X[1], Y[1], Z[1]], [X[1], Y[0], Z[1]], [1, 0, 0]);
  }
  function disposeGroup(g) { g.traverse(function (n) { if (n.geometry) n.geometry.dispose(); }); root.remove(g); }
  function cullBehind(along) {
    while (groups.length > 1 && groups[1].userData.along < along - 60) {
      var g = groups.shift();
      movers = movers.filter(function (m) { var keep = true; g.traverse(function (n) { if (n === m) keep = false; }); return keep; });
      disposeGroup(g);
    }
  }
  function clearTrack() { groups.forEach(disposeGroup); groups = []; movers = []; builtBlocks = 0; }

  // ---- ball, trail, shatter, stars ---------------------------------------------------------------
  var ballGroup = new THREE.Group(), spin = new THREE.Group();
  // the original ball: a glowing white wire globe over a dim translucent body
  spin.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshBasicMaterial({ color: 0x2a5866, transparent: true, opacity: 0.55, depthWrite: false })));
  var circ = [];
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(function (axis, c) {
    for (var i = 0; i < 48; i++) {
      var a0 = i / 48 * Math.PI * 2, a1 = (i + 1) / 48 * Math.PI * 2, r = 0.505;
      var p0 = [Math.cos(a0) * r, Math.sin(a0) * r, 0], p1 = [Math.cos(a1) * r, Math.sin(a1) * r, 0];
      var rot = function (p) { return c === 0 ? p : c === 1 ? [p[2], p[1], p[0]] : [p[0], p[2], p[1]]; };
      circ.push.apply(circ, rot(p0).concat(rot(p1)));
    }
  });
  var lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(circ, 3));
  // thick rings (browsers draw lines one pixel wide): an equator and two meridians, like the original's globe
  var ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  [[0, 0, 0], [Math.PI / 2, 0, 0], [0, Math.PI / 2, 0]].forEach(function (r) {
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.028, 6, 40), ringMat); ring.rotation.set(r[0], r[1], r[2]); spin.add(ring);
  });
  var halo = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14), new THREE.MeshBasicMaterial({ color: 0x4acbe1, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
  ballGroup.add(halo);
  ballGroup.add(spin); scene.add(ballGroup);

  var TRAIL = 22, trailPts = [], trailPos = new Float32Array(TRAIL * 6), trailCol = new Float32Array(TRAIL * 6), idx = [];
  for (var ti = 0; ti < TRAIL; ti++) {
    var f = Math.pow(1 - ti / TRAIL, 1.5);
    for (var e2 = 0; e2 < 2; e2++) { var o3 = (ti * 2 + e2) * 3; trailCol[o3] = 0.41 * f; trailCol[o3 + 1] = f; trailCol[o3 + 2] = f; }
    if (ti < TRAIL - 1) { var a = ti * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  var trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute("color", new THREE.BufferAttribute(trailCol, 3));
  trailGeo.setIndex(idx);
  var trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  trail.frustumCulled = false; scene.add(trail);
  function pushTrail(reset) {
    var pt = [ball.p[0], ball.p[1] - 0.35, -ball.p[2]];
    if (reset) { trailPts = []; for (var i = 0; i < TRAIL; i++) trailPts.push(pt); }
    else { trailPts.pop(); trailPts.unshift(pt); }
    for (var j = 0; j < TRAIL; j++) {
      var p = trailPts[j], hw = 0.16 * (1 - j / TRAIL), o = j * 6;
      trailPos[o] = p[0] - hw; trailPos[o + 1] = p[1]; trailPos[o + 2] = p[2];
      trailPos[o + 3] = p[0] + hw; trailPos[o + 4] = p[1]; trailPos[o + 5] = p[2];
    }
    trailGeo.attributes.position.needsUpdate = true;
  }

  // The original's death: 23 magenta cubes thrown out with force 40, radius 15, upward modifier 2.
  var SHARDS = 23, shards = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xde79e7 }), SHARDS);
  shards.visible = false; shards.frustumCulled = false; scene.add(shards);
  var shardV = [], shardP = [], shardAge = 0, tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();
  function shatter(x, y, z, vel) {
    shards.visible = true; shardAge = 0; shardV = []; shardP = [];
    for (var i = 0; i < SHARDS; i++) {
      var th = Math.random() * Math.PI * 2, sp = 6 + Math.random() * 10;
      shardV.push([vel[0] * 0.3 + Math.cos(th) * sp, vel[1] * 0.3 + 4 + Math.random() * 8, vel[2] * 0.3 + Math.sin(th) * sp]);
      shardP.push([x, y, z, Math.random() * 6]);
    }
  }
  function updateShards(dt) {
    if (!shards.visible) return;
    shardAge += dt;
    for (var i = 0; i < SHARDS; i++) {
      var v = shardV[i], p = shardP[i];
      v[1] -= 9.81 * dt; p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt; p[3] += dt * 6;
      tmpQ.setFromEuler(tmpE.set(p[3], p[3] * 0.7, 0));
      var sc = Math.max(0.01, 1 - shardAge / 2);
      tmpM.compose(tmpV.set(p[0], p[1], -p[2]), tmpQ, tmpS.set(sc, sc, sc));
      shards.setMatrixAt(i, tmpM);
    }
    shards.instanceMatrix.needsUpdate = true;
    if (shardAge > 2) shards.visible = false;   // the original destroys the bits after 2 s
  }

  var starGeo = new THREE.BufferGeometry(), sp = [];
  for (var si = 0; si < 600; si++) {
    var az = Math.random() * Math.PI * 2, el = Math.random() * 1.3 - 0.2, rr = 1500;
    sp.push(Math.cos(az) * Math.cos(el) * rr, Math.sin(el) * rr, Math.sin(az) * Math.cos(el) * rr);
  }
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  var stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9fc8d8, size: 1.5, sizeAttenuation: false, fog: false }));
  scene.add(stars);

  // ---- audio: a small synth so there are no audio files to load -------------------------------
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
    function noise(t, dur, vol) {
      var len = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      var s = ctx.createBufferSource(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
      fl.type = "highpass"; fl.frequency.value = 6000;
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
  // ---- full screen: hide the site bar and, where the browser allows, take the whole screen ------------
  var fullBtn = $("fullBtn");
  function isFull() { return document.body.classList.contains("immersive"); }
  function renderFull() {
    var on = isFull();
    fullBtn.setAttribute("aria-pressed", String(on)); fullBtn.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
    $("fsOpen").hidden = on; $("fsClose").hidden = !on;
    setTimeout(resize, 50);
  }
  function setFull(on) {
    document.body.classList.toggle("immersive", on);
    var el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    var exit = document.exitFullscreen || document.webkitExitFullscreen, cur = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (on && req && !cur) { var p = req.call(el); if (p && p.catch) p.catch(function () { /* refused: keep the bar hidden anyway */ }); }
      if (!on && exit && cur) { var q = exit.call(document); if (q && q.catch) q.catch(function () {}); }
    } catch (e) { /* no Fullscreen API (iPhone): hiding the bar is the whole effect */ }
    renderFull();
  }
  fullBtn.addEventListener("click", function () { setFull(!isFull()); });
  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) {
    document.addEventListener(ev, function () {
      if (!(document.fullscreenElement || document.webkitFullscreenElement) && isFull()) { document.body.classList.remove("immersive"); renderFull(); }
    });
  });
  renderFull();
  ui.sound.addEventListener("click", function () { soundOn = !soundOn; save("s3r-sound", soundOn); audio.unlock(); audio.setOn(soundOn); renderSound(); });
  renderSound();

  // ---- input ---------------------------------------------------------------------------------------
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
    if (e.key === "f" || e.key === "F") { setFull(!isFull()); return; }
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
    if (e.pointerType === "mouse" && e.target === canvas) return;
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

  // ---- game flow ---------------------------------------------------------------------------------------
  var state = "menu", acc = 0, hintTimer = 0, speedTimer = 0, shownScore = -1, overTimer = 0, runSeed = 0, seenSpeedUps = 0, landPulse = 0;
  function newWorld() {
    clearTrack();
    runSeed = (Math.random() * 4294967296) >>> 0;
    world = new W.World(runSeed);
    ball = new B.Ball(CFG);
    buildBlocks();
    acc = 0; shards.visible = false; ballGroup.visible = true; seenSpeedUps = 0;
    cam.reset(); pushTrail(true);
  }
  function setPlaying(on) {
    document.body.classList.toggle("playing", on);
    ui.score.hidden = !on; ui.pauseBtn.hidden = !on;
    ui.arrowL.hidden = ui.arrowR.hidden = !on;
  }
  function showOnly(el) { [ui.menu, ui.board, ui.over, ui.paused].forEach(function (x) { x.hidden = x !== el; }); }
  function showMenu() { state = "menu"; setPlaying(false); showOnly(ui.menu); audio.music(false); clearTimeout(overTimer); }
  function startRun() {
    audio.unlock(); clearTimeout(overTimer);
    newWorld();
    state = "play"; setPlaying(true); showOnly(null);
    shownScore = -1; keys.l = keys.r = false; touches.clear();
    ui.hint.hidden = false; ui.hint.style.opacity = "1";
    clearTimeout(hintTimer); hintTimer = setTimeout(function () { ui.hint.style.opacity = "0"; }, 3000);
    audio.music(soundOn);
    canvas.focus({ preventScroll: true });
    last = performance.now();
  }
  function pause() { state = "pause"; showOnly(ui.paused); audio.music(false); $("resumeBtn").focus({ preventScroll: true }); }
  function resume() { state = "play"; showOnly(null); audio.music(soundOn); last = performance.now(); canvas.focus({ preventScroll: true }); }
  function runRecord() { return { score: ball.score, dist: Math.max(0, Math.floor(W.along(ball.p))), t: +ball.t.toFixed(2), seed: runSeed }; }
  function gameOver() {
    state = "over";
    audio.music(false); audio.sfx(ball.cause === "fall" ? "fall" : "die");
    ui.speedup.classList.remove("on");
    var run = runRecord(), isBest = !best || run.score > best.score;
    if (isBest && run.score > 0) { best = run; save("s3r-best", best); }
    ui.finalScore.textContent = run.score;
    ui.finalScore.classList.toggle("new", isBest && run.score > 0);
    ui.finalBest.textContent = best ? best.score : 0;
    ui.postStatus.textContent = ""; ui.postStatus.className = "status";
    maybePost(run);
    overTimer = setTimeout(function () {   // the original shows its panel 1 s after the run ends
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

  // ---- camera: the original's rig follows the ball rigidly; the camera inside it eases from its
  //      start pose to the chase pose (3.06 m up, 1.21 m back, 51.6 degrees down) -------------------
  var cam = (function () {
    var CW = S3BLOCKS.world.cameraRig;
    var startP = CW.startPos.localPos, startQ = CW.startPos.localRot, chaseP = CW.chasePos.localPos, chaseQ = CW.chasePos.localRot;
    var lp, lq, frozen = null, look = new THREE.Vector3(), fovEvt = null;
    function lerp(a, b, t) { return a + (b - a) * t; }
    function slerpQ(a, b, t) { var qa = new THREE.Quaternion(a[0], a[1], a[2], a[3]), qb = new THREE.Quaternion(b[0], b[1], b[2], b[3]); qa.slerp(qb, t); return [qa.x, qa.y, qa.z, qa.w]; }
    function fovNow() {
      if (!fovEvt) return 60;
      var d = ball.t - fovEvt.t0;
      if (fovEvt.kind === "start") {   // first touch: 70 over 0.3 s, then back to 60 over 0.4 s (out-circ) after 0.4 s
        if (d < 0.3) return lerp(60, 70, d / 0.3);
        if (d < 0.7) return 70;
        var u = Math.min(1, (d - 0.7) / 0.4); return lerp(70, 60, Math.sqrt(1 - (u - 1) * (u - 1)));
      }
      if (d < 0.15) return lerp(fovEvt.from, 75, d / 0.15);   // speed-up: 75 in 0.15 s
      if (d < 1.6) return 75;
      return lerp(75, 60, Math.min(1, (d - 1.6) / 6));          // then 60 over 6 s
    }
    return {
      reset: function () { lp = startP.slice(); lq = startQ.slice(); frozen = null; fovEvt = null; this.place(0); },
      touch: function () { fovEvt = { kind: "start", t0: ball.t }; },
      boost: function () { fovEvt = { kind: "boost", t0: ball.t, from: camera.fov }; },
      place: function (dt) {
        var k = Math.min(1, (ball.touched ? 0.01 : 0.002) * dt * 60);   // per-frame lerp in the original, at 60 fps
        lp = [lerp(lp[0], chaseP[0], k), lerp(lp[1], chaseP[1], k), lerp(lp[2], chaseP[2], k)];
        lq = slerpQ(lq, chaseQ, k);
        if (ball.dead && !frozen) frozen = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
        if (frozen) {
          camera.position.copy(frozen.pos);
          // the original slerps toward a look at the ball at 5 x dt after death
          var m = new THREE.Matrix4().lookAt(camera.position, new THREE.Vector3(ball.p[0], ball.p[1], -ball.p[2]), new THREE.Vector3(0, 1, -1).normalize());
          var target = new THREE.Quaternion().setFromRotationMatrix(m);
          camera.quaternion.slerp(target, Math.min(1, 5 * dt));
        } else {
          camera.position.set(ball.p[0] + lp[0], ball.p[1] + lp[1], -(ball.p[2] + lp[2]));
          var fwd = P.qrot(lq, [0, 0, 1]), up = P.qrot(lq, [0, 1, 0]);
          camera.up.set(up[0], up[1], -up[2]);
          look.set(camera.position.x + fwd[0], camera.position.y + fwd[1], camera.position.z - fwd[2]);
          camera.lookAt(look);
        }
        var fov = fovNow();
        if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
        stars.position.copy(camera.position);
      }
    };
  })();

  // ---- frame loop -----------------------------------------------------------------------------------
  var last = performance.now(), frames = 0, frameAcc = 0, slow = 0, fast = 0, wasTouched = false;
  function setQuality(q) {
    quality = q;
    ALL_TEX.forEach(function (t) { t.anisotropy = q >= 1 ? 1 : ANISO; t.needsUpdate = true; });
    MATS.City.visible = q < 2;
  }
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
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    if (state === "play") {
      acc += dt;
      var inp = input(), steps = 0;
      while (acc >= CFG.dt && steps < 10) { B.step(world, ball, inp); acc -= CFG.dt; steps++; if (ball.dead) break; }
      if (acc > CFG.dt) acc = 0;   // a long stall: drop the backlog rather than fast-forward
      if (ball.touched && !wasTouched) { wasTouched = true; cam.touch(); }
      if (ball.speedUps > seenSpeedUps) {
        seenSpeedUps = ball.speedUps; cam.boost(); audio.sfx("speed");
        ui.speedup.classList.add("on"); clearTimeout(speedTimer);
        speedTimer = setTimeout(function () { ui.speedup.classList.remove("on"); }, 1600);
      }
      if (ball.score !== shownScore) { shownScore = ball.score; ui.score.textContent = shownScore; }
      if (ball.dead) {
        acc = 0;
        if (ball.cause !== "fall") { shatter(ball.p[0], ball.p[1], ball.p[2], ball.v); ballGroup.visible = false; }
        gameOver();
      }
      buildBlocks();
    } else if (state === "over" && ball.cause === "fall") {
      ball.v[1] -= 9.81 * dt; ball.p = P.add(ball.p, P.mul(ball.v, dt));   // keep falling into the void
    }
    if (state === "menu") wasTouched = false;
    if (ball.landed > 0) { landPulse = ball.landed; ball.landed = 0; }
    landPulse = Math.max(0, landPulse - dt * 5);
    ballGroup.position.set(ball.p[0], ball.p[1] - landPulse * 0.06, -ball.p[2]);
    spin.quaternion.set(-ball.q[0], -ball.q[1], ball.q[2], ball.q[3]);
    spin.scale.set(1 + landPulse * 0.12, 1 - landPulse * 0.16, 1 + landPulse * 0.12);
    var trailOn = ball.t - ball.speedUpAt < CFG.speedUpTime + 0.4 && ballGroup.visible;   // the original shows its trail on speed-ups
    if (state === "play" || state === "over") pushTrail(false);
    trail.visible = trailOn;
    for (var m = 0; m < movers.length; m++) {
      var mv = movers[m], col = mv.userData.col, off = world.colOffset(col, ball.t), org = col.origin, go = mv.parent.position;
      mv.position.set(org[0] + off[0] - go.x, org[1] + off[1] - go.y, -(org[2] + off[2]) - go.z);
    }
    updateShards(dt);
    if (state !== "pause") cam.place(dt);
    cullBehind(W.along(ball.dead ? [0, camera.position.y, -camera.position.z] : ball.p));
    renderer.render(scene, camera);
    adaptQuality(dt);
  }

  // ---- scores on Bluesky -------------------------------------------------------------------------------
  var scores = null;
  function accept(v) {
    // A run's score must fit its own distance and time. Not proof, but it drops nonsense.
    if (!Number.isInteger(v.value) || v.value < 0 || v.value > 50000) return false;
    var m = /dist=(\d+)\b.*\bt=([\d.]+)/.exec(v.detail || "");
    if (!m) return false;
    var dist = +m[1], t = +m[2];
    if (!(t > 0) || dist > t * 400 + 100) return false;
    return v.value <= dist / 35 + 3;
  }
  function detailOf(run) { return "seed=" + run.seed + " dist=" + run.dist + " t=" + run.t + " v=" + VERSION; }
  function postedBest() { return scores && scores.did ? load("s3r-posted:" + scores.did, 0) : 0; }
  function setStatus(text, cls, retry) {
    ui.postStatus.textContent = text; ui.postStatus.className = "status" + (cls ? " " + cls : "");
    if (retry) { var b = document.createElement("button"); b.type = "button"; b.textContent = "Try again"; b.addEventListener("click", retry); ui.postStatus.append(" ", b); }
  }
  function postRun(run, onDone) {
    scores.post({ value: run.score, detail: detailOf(run) }).then(function () {
      save("s3r-posted:" + scores.did, run.score);
      if (pending && pending.score <= run.score) { pending = null; save("s3r-pending", null); }
      onDone(null);
    }, function (err) { onDone(err); });
  }
  function maybePost(run) {
    if (run.score <= 0) return;
    if (scores && scores.did) {
      if (run.score <= postedBest()) return;
      var attempt = function () {
        setStatus("Posting to the leaderboard…");
        postRun(run, function (err) { if (err) setStatus("Couldn't post: " + err.message, "err", attempt); else setStatus("New best posted to the leaderboard.", "ok"); });
      };
      attempt();
    } else if (!pending || run.score > pending.score) {
      if (best && best.score === run.score) { pending = run; save("s3r-pending", pending); }
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
    if (!scores.enabled) { ui.handle.disabled = true; $("signInBtn").disabled = true; note("Sign-in works on joshuashew.com."); return; }
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

  // ---- boot ---------------------------------------------------------------------------------------------
  newWorld();
  showMenu();
  requestAnimationFrame(frame);
  window.__ng = {
    get state() { return state; }, get ball() { return ball; }, get world() { return world; },
    get along() { return W.along(ball.p); }, get x() { return ball.p[0]; },
    get pixelRatio() { return pr; }, get drawCalls() { return renderer.info.render.calls; },
    get geometries() { return renderer.info.memory.geometries; }, get quality() { return quality; }, gpu: gpuName,
    start: startRun, keys: keys, accept: accept, mats: MATS, renderer: renderer
  };
})();
