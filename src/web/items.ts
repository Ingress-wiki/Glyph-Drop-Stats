/** The groups in DynamicGlyph's item list (`Docs/GEAR_DROP_ITEMS.md`), shown as row tags. */
const CATEGORIES: Record<string, string> = {
  Resonator: "levelled",
  "XMP Burster": "levelled",
  "Ultra Strike": "levelled",
  "Power Cube": "levelled",
  "Portal Shield": "mod",
  "Aegis Shield": "mod",
  "Force Amp": "mod",
  Turret: "mod",
  "Heat Sink": "mod",
  "Multi-Hack": "mod",
  "Link Amp": "mod",
  "SoftBank Ultra Link": "mod",
  "ITO EN Transmuter (+)": "mod",
  "ITO EN Transmuter (-)": "mod",
  "Portal Key": "other",
  Hypercube: "other",
  "ADA Refactor": "other",
  "JARVIS Virus": "other",
  Capsule: "other",
  "Kinetic Capsule": "other",
  Media: "other",
};

export function itemCategory(name: string): string | null {
  return CATEGORIES[name] ?? null;
}

/** Whether a row matches the search box: by name, or exactly by tag. */
export function matchesSearch(name: string, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (query === "") return true;
  return name.toLowerCase().includes(query) || itemCategory(name) === query;
}
