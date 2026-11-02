// Body style presets, shared by the visual model and the collision hull.
// Heights are metres above the ground at rest. ws/rf/rr/cr are fractions of the car length
// measured from the nose: windscreen base, roof front, roof rear, cabin rear base.
export const STYLE_PRESETS = {
  hatch: { clearance: 0.16, noseY: 0.62, hoodY: 0.88, beltY: 0.94, deckY: 0.96, roofY: 1.45, ws: 0.26, rf: 0.43, rr: 0.9, cr: 0.97, taper: 0.8 },
  sedan: { clearance: 0.14, noseY: 0.6, hoodY: 0.82, beltY: 0.86, deckY: 0.9, roofY: 1.4, ws: 0.3, rf: 0.44, rr: 0.72, cr: 0.84, taper: 0.8 },
  coupe: { clearance: 0.13, noseY: 0.52, hoodY: 0.74, beltY: 0.8, deckY: 0.86, roofY: 1.27, ws: 0.34, rf: 0.5, rr: 0.74, cr: 0.9, taper: 0.76 },
  muscle: { clearance: 0.15, noseY: 0.7, hoodY: 0.9, beltY: 0.92, deckY: 0.93, roofY: 1.32, ws: 0.42, rf: 0.54, rr: 0.74, cr: 0.82, taper: 0.8 },
  super: { clearance: 0.11, noseY: 0.42, hoodY: 0.64, beltY: 0.76, deckY: 0.9, roofY: 1.14, ws: 0.25, rf: 0.42, rr: 0.62, cr: 0.88, taper: 0.72 },
  rally: { clearance: 0.24, noseY: 0.74, hoodY: 1.0, beltY: 1.06, deckY: 1.08, roofY: 1.56, ws: 0.26, rf: 0.42, rr: 0.9, cr: 0.97, taper: 0.8 },
  suv: { clearance: 0.3, noseY: 0.9, hoodY: 1.1, beltY: 1.14, deckY: 1.18, roofY: 1.86, ws: 0.27, rf: 0.37, rr: 0.93, cr: 0.99, taper: 0.86 },
  // open two-seater: roofY is the top of the windscreen frame, the cockpit runs from ws to cr
  roadster: { clearance: 0.12, noseY: 0.5, hoodY: 0.72, beltY: 0.8, deckY: 0.84, roofY: 1.1, ws: 0.36, rf: 0.45, rr: 0.62, cr: 0.66, taper: 0.9, open: true },
  // crew cab ending at cr, open bed behind it up to the deck (bed rim) height
  pickup: { clearance: 0.36, noseY: 0.98, hoodY: 1.2, beltY: 1.24, deckY: 1.26, roofY: 1.98, ws: 0.24, rf: 0.33, rr: 0.5, cr: 0.54, taper: 0.88 },
};

/**
 * Resolve a car's body into absolute coordinates. Longitudinal values are "forward metres"
 * from the mid-point between the axles (+ = towards the nose).
 */
export function resolveBodyShape(def) {
  const lay = def.layout;
  const p = { ...STYLE_PRESETS[def.body.style], ...(def.body.shape || {}) };
  const L = lay.length;
  const wb = lay.wheelbase;
  const frontOverhang = lay.frontOverhang ?? (L - wb) / 2;
  const front = wb / 2 + frontOverhang;
  const rear = front - L;
  const at = (f) => front - f * L;
  return {
    ...p,
    L,
    W: lay.width,
    wb,
    front,
    rear,
    xWs: at(p.ws),
    xRf: at(p.rf),
    xRr: at(p.rr),
    xCr: at(p.cr),
    wheelRadius: lay.wheelRadius,
    wheelWidth: lay.wheelWidth,
    track: lay.track,
  };
}

/** Convex hull points (ground frame, forward = +X) approximating the body for collisions. */
export function hullPoints(s) {
  const hw = s.W / 2 - 0.02;
  const tw = hw * s.taper;
  const pts = [];
  const add = (x, y, half) => {
    pts.push([x, y, half], [x, y, -half]);
  };
  add(s.front - 0.08, s.clearance + 0.06, hw * 0.92);
  add(s.front, s.clearance + 0.16, hw * 0.95);
  add(s.front, s.noseY - 0.04, hw * 0.95);
  add(s.xWs, s.hoodY, hw);
  add(s.xRf, s.roofY, tw);
  // open cars have no roof behind the windscreen: the hull drops back to the belt line
  add(s.xRr, s.open ? s.beltY + 0.15 : s.roofY, tw);
  add(s.rear, s.deckY - 0.06, hw * 0.95);
  add(s.rear, s.clearance + 0.16, hw * 0.95);
  add(s.rear + 0.08, s.clearance + 0.06, hw * 0.92);
  return pts;
}
