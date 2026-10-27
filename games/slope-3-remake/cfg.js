/* Ball settings, as measured from the original (see blocks.js "world"). */
var S3CFG = (function (D) {
  var w = D.world;
  return {
    dt: w.fixedDt, mass: w.ball.mass, radius: w.ball.radius, gravity: w.gravity,
    drag: w.ball.drag, angularDrag: w.ball.angularDrag,
    friction: (w.ball.friction.dynamic + 0.6) / 2,   // ball (0.9) averaged with Unity's default 0.6 on the invisible planes it rolls on
    frictionTrack: (w.ball.friction.dynamic + 0.8) / 2, // ball averaged with the visible track material (0.8)
    maxAngular: 7,                                    // Unity's default max angular speed (PhysicsManager)
    bounce: 0, startTurnForce: w.startTurnForce, firstLift: 5,
    speedUpPush: w.speedUpPushForce, speedUpTime: w.speedUpTime, startZoneForce: w.startZoneForcePerSecond,
    start: w.ballStart.pos.slice()
  };
})(typeof S3BLOCKS !== "undefined" ? S3BLOCKS : require("./blocks.js"));
if (typeof module !== "undefined") module.exports = S3CFG;
