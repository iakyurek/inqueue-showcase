// Natural, Etsy-friendly title casing for listing titles (title_description).
//
// This governs ONLY the listing title shown in metadata and written to
// manifest_input.csv. It is deliberately separate from the artwork text that
// gets rendered into the PNG (brief.mainPhrase, which stays uppercase by
// design) — see lib/svgRender.js.
//
// Goals:
//   - No shouting: "TRENDY MAMA T-SHIRT DESIGN" -> "Trendy Mama T-Shirt Design"
//   - No over-capitalized connectors: "...Design With Style For Moms"
//     -> "...Design with Style for Moms"
//   - Preserve known print/file acronyms: PNG, SVG, DTF, ...

// Short connective words that stay lowercase unless they are the first or
// last word of the title.
const MINOR_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into",
  "nor", "of", "off", "on", "onto", "or", "over", "per", "the", "to", "up",
  "via", "vs", "with", "yet", "so",
]);

// Domain acronyms that should stay fully uppercase.
const ACRONYMS = new Set([
  "PNG", "SVG", "DTF", "DTG", "PDF", "JPG", "JPEG", "EPS", "DXF", "DIY",
  "USA", "HTV", "UV", "3D",
]);

// Case a single space-delimited word (or one hyphen segment of it). Keeps any
// surrounding punctuation (commas, apostrophes) intact.
function caseSegment(segment, forceCapital) {
  const alnum = segment.replace(/[^A-Za-z0-9]/g, "");
  if (!alnum) return segment; // pure punctuation, e.g. "&" or "-"
  if (ACRONYMS.has(alnum.toUpperCase())) return segment.toUpperCase();

  const alpha = segment.replace(/[^A-Za-z]/g, "").toLowerCase();
  if (!forceCapital && MINOR_WORDS.has(alpha)) return segment.toLowerCase();

  // Lowercase everything, then uppercase the first alphabetical character so
  // "MOM'S" -> "Mom's" (not "Mom'S") and "aesthetic," -> "Aesthetic,".
  return segment.toLowerCase().replace(/[a-z]/, (ch) => ch.toUpperCase());
}

function caseWord(word, isEdge) {
  if (word.includes("-")) {
    // Capitalize each side of a hyphenated compound: "t-shirt" -> "T-Shirt".
    return word.split("-").map((part) => caseSegment(part, true)).join("-");
  }
  return caseSegment(word, isEdge);
}

// Normalize an Etsy listing title to natural title case. Idempotent: applying
// it to an already-clean title returns the same string.
export function normalizeListingTitle(title) {
  const cleaned = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const words = cleaned.split(" ");
  const lastIndex = words.length - 1;
  return words
    .map((word, index) => caseWord(word, index === 0 || index === lastIndex))
    .join(" ");
}

// File-format / digital-download vocabulary that must never appear in the
// listing title: these listings sell a PHYSICAL printed shirt, and titles
// like "... T-Shirt Design PNG" read as digital downloads to buyers and to
// Etsy search. Deterministic scrub so the rule holds even when the metadata
// model ignores its instructions. Whole-word match on the letters-only core,
// so "Downtown"/"Profile" are untouched while "PNG,"/"download." are removed.
const DIGITAL_TERMS = new Set([
  "png", "svg", "jpg", "jpeg", "pdf", "eps", "dxf", "digital", "download",
  "downloads", "downloadable", "printable", "sublimation", "clipart",
  "cricut", "silhouette", "file", "files", "transparent", "dtf", "dtg",
  "htv",
]);

export function scrubDigitalTerms(title) {
  const kept = String(title ?? "")
    .split(/\s+/)
    .filter((word) => {
      const core = word.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
      return core === "" || !DIGITAL_TERMS.has(core);
    });
  return kept
    .join(" ")
    .replace(/\s+,/g, ",")      // "Tee , Gift" -> "Tee, Gift"
    .replace(/,(\s*,)+/g, ",")  // collapse ",  ," left by removed words
    .replace(/^[,\s]+/, "")     // no leading comma
    .replace(/[,\s]+$/, "")     // no trailing comma
    .trim();
}

export function containsDigitalTerm(text) {
  return String(text ?? "")
    .split(/\s+/)
    .some((word) => DIGITAL_TERMS.has(word.replace(/[^A-Za-z0-9]/g, "").toLowerCase()));
}
