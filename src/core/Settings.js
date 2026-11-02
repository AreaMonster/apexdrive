const KEY = 'apexdrive.settings.v1';

export const DEFAULT_SETTINGS = {
  quality: 'medium',
  camera: 'chase',
  transmission: 'auto',
  assists: { abs: true, tcs: true, steering: true },
  showHelp: true,
  debug: false,
  bindings: {},
  lastCarId: 'halden_kestrel',
  lastMap: 'harrow_park',
  damageMode: 'full', // full | visual | off
  ghost: true,
  timePreset: 'map', // see data/weather.js TIME_PRESETS
  weather: 'map', // 'map' or a key of WEATHER
  audio: { master: 0.8, engine: 0.9, effects: 0.9, ambient: 0.7 },
  touch: 'auto', // auto | on | off (on-screen controls)
  dynamicRes: true, // lower the render resolution when the frame rate drops
};

function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

export function loadSettings() {
  try {
    return merge(DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch {
    return merge(DEFAULT_SETTINGS, {});
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage full or blocked (private mode): settings just won't persist
  }
}
