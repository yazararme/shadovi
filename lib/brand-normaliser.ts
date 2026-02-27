// Brand name normalisation map.
// Keys are lowercase trimmed variants; values are canonical display names.
// Applied at insert time in the runner so rate calculations are never fragmented
// across variants ("Samsung", "Samsung Electronics", "Samsung appliances" → "Samsung").
// Raw strings are preserved in brand_name_raw for auditing.
//
// Extend this map as new variants appear in the console logs
// ([brand-normaliser] Unmatched brands: ...).
export const BRAND_NORMALISATION_MAP: Record<string, string> = {
  // Samsung
  "samsung electronics": "Samsung",
  "samsung appliances": "Samsung",
  "samsung": "Samsung",

  // Bosch
  "bosch home appliances": "Bosch",
  "bosch appliances": "Bosch",
  "bosch": "Bosch",

  // LG
  "lg electronics": "LG",
  "lg appliances": "LG",
  "lg": "LG",

  // Beko
  "beko appliances": "Beko",
  "beko": "Beko",

  // Siemens
  "siemens home appliances": "Siemens",
  "siemens": "Siemens",

  // Miele
  "miele": "Miele",

  // Whirlpool
  "whirlpool corporation": "Whirlpool",
  "whirlpool": "Whirlpool",

  // Haier / Hoover / Candy (same group)
  "haier": "Haier",
  "hoover": "Hoover",
  "candy": "Candy",

  // AEG
  "aeg appliances": "AEG",
  "aeg": "AEG",

  // Hotpoint / Indesit (Whirlpool group)
  "hotpoint": "Hotpoint",
  "indesit": "Indesit",

  // Zanussi
  "zanussi": "Zanussi",

  // Electrolux
  "electrolux home appliances": "Electrolux",
  "electrolux": "Electrolux",

  // Neff
  "neff": "Neff",

  // Beko sub-brands
  "blomberg": "Blomberg",
  "grundig": "Grundig",
};

export function normaliseBrandName(raw: string): string {
  const key = raw.toLowerCase().trim();
  return BRAND_NORMALISATION_MAP[key] ?? toTitleCase(raw.trim());
}

// Fallback for brand names not in the map — title-case the raw string and store it.
// Unknown brands are accumulated rather than dropped so the map can be extended.
function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) =>
    txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
  );
}
