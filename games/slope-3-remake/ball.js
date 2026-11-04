/* Slope 3 Remake ball dynamics. The world supplies:
     world.query(p, r, t)    -> colliders near p at time t: {id, kind:"box"|"tri", death, vel, ...shape}
     world.triggers(p, r, t) -> triggers the ball overlaps: {id, kind:"score"|"speedUp"|"fallout"|"startForce"}
     world.floorBelow(p)     -> lowest track height near p (a backstop against endless falls)
   Forces follow the original: AddForce(h * turnForce, 0, 0) for steering, a stacking (0, yForce, zForce)
   push from speed-ups, a +5 m/s^2 lift until the first touch, then gravity, drag and contact friction. */
var S3B = (function (P) {
  "use strict";
  var add = P.add, sub = P.sub, mul = P.mul, dot = P.dot, cross = P.cross, len = P.len;

  function Ball(cfg) {
    this.cfg = cfg;
    this.p = cfg.start.slice(); this.v = [0, 0, 0]; this.w = [0, 0, 0];
    this.q = [0, 0, 0, 1];                 // orientation, for drawing the spin
    this.t = 0; this.dead = false; this.cause = "";
    this.turnForce = cfg.startTurnForce; this.yForce = 0; this.zForce = 0;
    this.touched = false; this.score = 0; this.speedUps = 0; this.speedUpAt = -1e9;
    this.fired = {}; this.ground = false; this.airTime = 0; this.topSpeed = 0; this.landed = 0;
  }
  Ball.prototype.clone = function () {
    var b = Object.create(Ball.prototype);
    for (var k in this) if (Object.prototype.hasOwnProperty.call(this, k)) {
      var x = this[k];
      b[k] = Array.isArray(x) ? x.slice() : (k === "fired" ? Object.assign({}, x) : x);
    }
    return b;
  };

  function die(b, cause) { b.dead = true; b.cause = cause; }

  // One fixed step (the original's FixedUpdate, 0.01 s).
  function step(world, b, inp) {
    if (b.dead) return;
    var c = b.cfg, dt = c.dt, m = c.mass, r = c.radius;
    b.t += dt;

    // forces (AddForce, ForceMode.Force): a = F / m
    var F = [inp ? inp * b.turnForce : 0, c.gravity * m + b.yForce, b.zForce];
    b.v = add(b.v, mul(F, dt / m));
    if (!b.touched) b.v[1] += c.firstLift * dt;      // VelocityChange lift before the first touch
    // PhysX damping
    b.v = mul(b.v, 1 / (1 + c.drag * dt));
    b.w = mul(b.w, 1 / (1 + c.angularDrag * dt));

    // move in sub-steps short enough that no collider can be skipped
    var speed = len(b.v), n = Math.max(1, Math.ceil(speed * dt / (0.3 * r)));
    var h = dt / n, contacts = {}, hitDeath = false, grounded = false;
    for (var s = 0; s < n; s++) {
      b.p = add(b.p, mul(b.v, h));
      var near = world.query(b.p, r + 0.05, b.t);
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < near.length; i++) {
          var col = near[i], q, nrm, pen;
          if (col.kind === "box") {
            var cl = P.boxClosest(col, b.p);
            if (cl.inside) { var inn = P.boxInsideNormal(col, b.p); nrm = inn.n; pen = inn.pen + r; }
            else { var d = sub(b.p, cl.q), dl = len(d); if (dl >= r || dl < 1e-9) continue; nrm = mul(d, 1 / dl); pen = r - dl; }
          } else {
            q = P.triClosest(col, b.p);
            var d2 = sub(b.p, q), dl2 = len(d2);
            if (dl2 >= r) continue;
            nrm = dl2 > 1e-9 ? mul(d2, 1 / dl2) : col.n; pen = r - dl2;
          }
          if (col.death) hitDeath = true;
          b.p = add(b.p, mul(nrm, pen));
          var rel = sub(b.v, col.vel || [0, 0, 0]), vn = dot(rel, nrm);
          var jn = 0;
          if (vn < 0) { jn = -vn * (1 + c.bounce); b.v = add(b.v, mul(nrm, jn)); }
          var k = contacts[col.id] || (contacts[col.id] = { n: nrm, jn: 0, vel: col.vel || [0, 0, 0], mu: col.mu || c.friction });
          k.n = nrm; k.jn += jn;
          if (nrm[1] > 0.3) grounded = true;
        }
      }
      if (hitDeath) break;
    }
    if (hitDeath) { b.touched = true; return die(b, "block"); }

    // friction at each contact: remove slip at the contact point, limited by mu * normal impulse
    for (var id in contacts) {
      var k2 = contacts[id], rc = mul(k2.n, -r);
      var slip = sub(add(b.v, cross(b.w, rc)), k2.vel);
      var vt = sub(slip, mul(k2.n, dot(slip, k2.n))), vtl = len(vt);
      if (vtl < 1e-9) continue;
      // impulse that zeroes slip for a solid sphere: |J| = vt * m * 2/7
      var need = vtl * m * 2 / 7, lim = k2.mu * k2.jn * m;
      var J = mul(vt, -Math.min(need, lim) / vtl);
      b.v = add(b.v, mul(J, 1 / m));
      b.w = add(b.w, mul(cross(rc, J), 1 / (0.4 * m * r * r)));
      // the original's physics caps spin at 7 rad/s, so a fast ball skids and sliding friction slows it
      var wl0 = len(b.w); if (wl0 > c.maxAngular) b.w = mul(b.w, c.maxAngular / wl0);
    }
    var hadContact = false; for (var id2 in contacts) { hadContact = true; break; }
    if (hadContact && !b.touched) { b.touched = true; b.firstTouchAt = b.t; }
    if (grounded && !b.ground && b.airTime > 0.15) b.landed = Math.min(1, b.airTime / 0.8);
    b.ground = grounded; b.airTime = grounded ? 0 : b.airTime + dt;
    var sp = len(b.v); if (sp > b.topSpeed) b.topSpeed = sp;

    // spin for drawing
    var wl = len(b.w);
    if (wl > 1e-6) {
      var ax = mul(b.w, 1 / wl), ang = wl * dt, s2 = Math.sin(ang / 2);
      b.q = P.qmul([ax[0] * s2, ax[1] * s2, ax[2] * s2, Math.cos(ang / 2)], b.q);
      var ql = Math.hypot(b.q[0], b.q[1], b.q[2], b.q[3]); b.q = b.q.map(function (x) { return x / ql; });
    }

    // triggers
    var trig = world.triggers(b.p, r, b.t);
    for (var j = 0; j < trig.length; j++) {
      var tg = trig[j];
      if (tg.kind === "startForce") {
        b.turnForce += c.startZoneForce[0] * dt; b.yForce += c.startZoneForce[1] * dt; b.zForce += c.startZoneForce[2] * dt;
        continue;
      }
      if (b.fired[tg.id]) continue;
      b.fired[tg.id] = true;
      if (tg.kind === "score") b.score++;
      else if (tg.kind === "speedUp") {
        b.turnForce += c.speedUpPush[0]; b.yForce += c.speedUpPush[1]; b.zForce += c.speedUpPush[2];
        b.speedUps++; b.speedUpAt = b.t;
        if (world.onSpeedUp) world.onSpeedUp(tg, b);
      } else if (tg.kind === "fallout") return die(b, "fall");
    }
    // backstop for the original's "endless fall" bug: far below the track means the run is over
    if (b.p[1] < world.floorBelow(b.p) - 80) return die(b, "fall");
  }

  return { Ball: Ball, step: step };
})(typeof S3P !== "undefined" ? S3P : require("./phys.js"));
if (typeof module !== "undefined") module.exports = S3B;
