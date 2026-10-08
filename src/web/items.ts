/** The groups in DynamicGlyph's item list (`Docs/GEAR_DROP_ITEMS.md`), shown as row tags. */
export type Category = "levelled" | "mod" | "other";

const CATEGORIES: Readonly<Record<string, Category>> = {
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

export function itemCategory(name: string): Category | null {
  return CATEGORIES[name] ?? null;
}

/**
 * Whether a row matches the search box: by name, or exactly by a category,
 * written in English or in the page's language (`labels`).
 */
export function matchesSearch(name: string, search: string, labels: Readonly<Record<Category, string>>): boolean {
  const query = search.trim().toLowerCase();
  if (query === "") return true;
  const category = itemCategory(name);
  return (
    name.toLowerCase().includes(query) ||
    (category !== null && (category === query || labels[category].toLowerCase() === query))
  );
}
