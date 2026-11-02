// Normalised lateral force (0..1 of the available friction) as a function of slip angle.
// Rises smoothly to 1 at `peak`, then decays exponentially toward `slideGrip`.
// The drop after the peak is what makes a slide self-sustaining: once past the peak the
// rear axle has less grip than it had, so a drift holds until the driver unwinds it.
export function lateralCurve(slip, peak, slideGrip, falloff) {
  const x = Math.abs(slip) / peak;
  if (x < 1) return x * (2 - x);
  return slideGrip + (1 - slideGrip) * Math.exp(-(x - 1) * falloff);
}

// Real tyres lose friction coefficient as load rises, so transferring weight onto one end of
// the car reduces that axle's total grip. This is why anti-roll bar stiffness changes balance.
export function loadSensitivity(fz, fzNominal, k) {
  const f = 1 - k * (fz / fzNominal - 1);
  return f < 0.75 ? 0.75 : f > 1.15 ? 1.15 : f;
}
