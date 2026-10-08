// Copyright filter: when ON, strips and flags protected terms (brands, teams,
// characters, celebrities, protected slogans) and the generator is also told to
// avoid them. When OFF, this logic is skipped entirely.
//
// This list is a starter set, not exhaustive. Extend it (or back it with a
// trademark lookup) for production. Turning the filter OFF disables inkly's
// checks only — it does not grant rights to protected material.

export const CF_TERMS = [
  // brands
  "nike", "adidas", "puma", "reebok", "under armour", "gucci", "prada", "chanel",
  "louis vuitton", "supreme", "disney", "pixar", "marvel", "dc comics", "starbucks",
  "coca cola", "coca-cola", "pepsi", "apple", "google", "amazon", "netflix",
  "playstation", "xbox", "nintendo", "lego", "harley davidson", "jeep",
  // characters / franchises
  "mickey", "minnie", "pokemon", "pikachu", "mario", "luigi", "sonic", "batman",
  "superman", "spiderman", "spider-man", "star wars", "harry potter", "hello kitty",
  "snoopy", "garfield", "simpsons", "minions", "bluey", "grinch", "avengers",
  "iron man", "elsa", "frozen", "barbie", "spongebob", "naruto", "dragon ball",
  "goku", "stitch", "winnie the pooh", "scooby doo", "looney tunes",
  // sports leagues / teams (sample)
  "nfl", "nba", "mlb", "nhl", "fifa", "uefa", "premier league", "lakers", "yankees",
  "cowboys", "real madrid", "barcelona", "manchester united", "liverpool fc",
  "patriots", "warriors", "chiefs", "raiders", "packers",
  // celebrities (sample)
  "taylor swift", "beyonce", "drake", "lebron james", "messi", "ronaldo",
  "cristiano ronaldo", "kobe", "michael jordan", "elvis", "marilyn monroe",
];

export function applyCopyrightFilter(text) {
  if (!text) return { text: text || "", hits: [] };
  let out = text;
  const hits = [];
  for (const term of CF_TERMS) {
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    if (re.test(out)) {
      hits.push(term);
      out = out.replace(re, "").replace(/\s{2,}/g, " ").trim();
    }
  }
  return { text: out, hits: Array.from(new Set(hits)) };
}

export function filterInputs(inputs, copyrightFilter) {
  if (copyrightFilter !== "on") return { inputs, hits: [] };
  const fields = ["designPhrase", "prompt", "graphicElements", "niche"];
  const allHits = [];
  const cleaned = { ...inputs };
  for (const f of fields) {
    if (cleaned[f]) {
      const { text, hits } = applyCopyrightFilter(cleaned[f]);
      cleaned[f] = text;
      allHits.push(...hits);
    }
  }
  return { inputs: cleaned, hits: Array.from(new Set(allHits)) };
}
