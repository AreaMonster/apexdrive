// Surface / tyre interaction table.
//   mu         grip multiplier relative to dry asphalt
//   peakSlip   slip angle (rad) at which lateral force peaks
//   slideGrip  fraction of peak grip left when the tyre is fully sliding
//   falloff    how quickly grip drops from peak toward slideGrip past the peak
//   rolling    rolling-resistance coefficient (soft ground slows you down)
//   bumpiness  amplitude (m) of procedural surface roughness fed into the suspension
export const SURFACES = {
  asphalt: { label: 'Asphalt', mu: 1.0, peakSlip: 0.13, slideGrip: 0.74, falloff: 1.8, rolling: 0.012, bumpiness: 0 },
  wet: { label: 'Wet asphalt', mu: 0.72, peakSlip: 0.12, slideGrip: 0.66, falloff: 1.6, rolling: 0.014, bumpiness: 0 },
  kerb: { label: 'Kerb', mu: 0.9, peakSlip: 0.13, slideGrip: 0.7, falloff: 1.8, rolling: 0.016, bumpiness: 0.012 },
  dirt: { label: 'Dirt', mu: 0.68, peakSlip: 0.2, slideGrip: 0.84, falloff: 1.2, rolling: 0.03, bumpiness: 0.01 },
  gravel: { label: 'Gravel', mu: 0.62, peakSlip: 0.22, slideGrip: 0.86, falloff: 1.1, rolling: 0.035, bumpiness: 0.012 },
  grass: { label: 'Grass', mu: 0.52, peakSlip: 0.18, slideGrip: 0.8, falloff: 1.2, rolling: 0.06, bumpiness: 0.015 },
  mud: { label: 'Mud', mu: 0.42, peakSlip: 0.22, slideGrip: 0.85, falloff: 1.0, rolling: 0.1, bumpiness: 0.012 },
  sand: { label: 'Sand', mu: 0.5, peakSlip: 0.22, slideGrip: 0.85, falloff: 1.0, rolling: 0.12, bumpiness: 0.008 },
  snow: { label: 'Snow', mu: 0.38, peakSlip: 0.2, slideGrip: 0.85, falloff: 1.0, rolling: 0.035, bumpiness: 0.006 },
  ice: { label: 'Ice', mu: 0.13, peakSlip: 0.09, slideGrip: 0.78, falloff: 1.4, rolling: 0.008, bumpiness: 0 },
  // groomed lake-racing ice with a dusting of snow: low grip but drivable
  lakeice: { label: 'Lake ice', mu: 0.3, peakSlip: 0.13, slideGrip: 0.82, falloff: 1.1, rolling: 0.01, bumpiness: 0.003 },
};

// Tyre compounds scale grip per surface: sport tyres love tarmac, knobbly rally tyres dig
// into loose ground. peakSlipScale > 1 makes the tyre more progressive (easier to slide).
export const TIRE_TYPES = {
  road: { peakSlipScale: 1.0, grip: {} },
  sport: {
    peakSlipScale: 0.9,
    grip: { wet: 0.92, dirt: 0.88, gravel: 0.88, grass: 0.9, mud: 0.8, sand: 0.85, snow: 0.8, ice: 0.9 },
  },
  offroad: {
    peakSlipScale: 1.15,
    grip: { asphalt: 0.9, wet: 0.95, dirt: 1.25, gravel: 1.25, grass: 1.2, mud: 1.4, sand: 1.3, snow: 1.3, ice: 1.2, lakeice: 1.15 },
  },
};

export function surfaceOf(id) {
  return SURFACES[id] || SURFACES.asphalt;
}
