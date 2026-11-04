/* Slope 3 Remake physics: a rigid-body ball on box and triangle colliders, modelled on the
   original's Unity setup (fixed 0.01 s step, gravity, linear and angular drag, friction, no bounce).
   Coordinates are Unity's: x right, y up, z forward. Pure and deterministic; no rendering here. */
var S3P = (function () {
  "use strict";

  // ---- small vector helpers ------------------------------------------------------------------
  function v(x, y, z) { return [x, y, z]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  // quaternions [x, y, z, w]
  function qmul(a, b) {
    return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  }
  function qrot(q, p) {
    var u = [q[0], q[1], q[2]], s = q[3];
    var t = mul(cross(u, p), 2);
    return add(add(p, mul(t, s)), cross(u, t));
  }
  function qmat(q) {   // rotation matrix columns = local x, y, z axes in world
    return [qrot(q, [1, 0, 0]), qrot(q, [0, 1, 0]), qrot(q, [0, 0, 1])];
  }

  // ---- collision primitives --------------------------------------------------------------------
  // Box: centre c, half-extents h, axes A[3] (unit vectors). Closest point to p.
  function boxClosest(b, p) {
    var d = sub(p, b.c), q = b.c.slice(), inside = true;
    for (var i = 0; i < 3; i++) {
      var dist = dot(d, b.A[i]), e = b.h[i];
      if (dist > e) { dist = e; inside = false; } else if (dist < -e) { dist = -e; inside = false; }
      q = add(q, mul(b.A[i], dist));
    }
    return { q: q, inside: inside };
  }
  // When the centre is inside a box, push out through the nearest face.
  function boxInsideNormal(b, p) {
    var d = sub(p, b.c), best = 1e9, n = null, pen = 0;
    for (var i = 0; i < 3; i++) {
      var dist = dot(d, b.A[i]), gap = b.h[i] - Math.abs(dist);
      if (gap < best) { best = gap; n = mul(b.A[i], dist >= 0 ? 1 : -1); pen = gap; }
    }
    return { n: n, pen: pen };
  }
  function triClosest(t, p) {   // Ericson, Real-Time Collision Detection 5.1.5
    var a = t.a, b = t.b, c = t.c;
    var ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
    var d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return a;
    var bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return b;
    var vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, mul(ab, d1 / (d1 - d3)));
    var cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return c;
    var vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, mul(ac, d2 / (d2 - d6)));
    var va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) return add(b, mul(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
    var den = 1 / (va + vb + vc);
    return add(add(a, mul(ab, vb * den)), mul(ac, vc * den));
  }
  function sphereBoxOverlap(b, p, r) {
    var cl = boxClosest(b, p);
    if (cl.inside) return true;
    var d = sub(p, cl.q); return dot(d, d) <= r * r;
  }

  return {
    v: v, add: add, sub: sub, mul: mul, dot: dot, cross: cross, len: len, clamp: clamp,
    qmul: qmul, qrot: qrot, qmat: qmat,
    boxClosest: boxClosest, boxInsideNormal: boxInsideNormal, triClosest: triClosest, sphereBoxOverlap: sphereBoxOverlap
  };
})();
if (typeof module !== "undefined") module.exports = S3P;
