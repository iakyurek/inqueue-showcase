import OpenAI, { toFile } from "openai";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTransparentPng } from "./backgroundRemover.js";
import { renderDesignSvgToPng } from "./svgRender.js";
import {
  buildBriefSystemPrompt,
  buildReferenceSystemPrompt,
  buildImagePrompt,
  heuristicBrief,
} from "./designRules.js";
import { normalizeListingTitle, scrubDigitalTerms, containsDigitalTerm } from "./listingTitle.js";
import { reviewDesign, checkTransparency } from "./designQA.js";

// Test seam: lets the generation/QA retry logic run against a fake client.
let testClient;
export function __setOpenAIClientForTests(client) { testClient = client; }

export function getOpenAI() {
  if (testClient) return testClient;
  if (!process.env.OPENAI_API_KEY) return null;
  // Without a timeout, one hung request pins a scheduler slot indefinitely.
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 180_000,
    maxRetries: 1,
  });
}

function extractJson(text) {
  if (!text) throw new Error("Empty model response.");
  const cleaned = text.replace(/```json|```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("Model did not return JSON.");
  return JSON.parse(cleaned.slice(first, last + 1));
}

// A failed brief must surface as an error, never silently degrade into the
// heuristic that typesets the operator's raw prompt as the shirt text — the
// image prompt says "spell exactly" for whatever mainPhrase it receives, so
// the fallback produced shirts reading "CREATE A TRANSPARENT PNG T-SHIRT
// DESIGN FOR ...". The heuristic remains available only in explicit
// placeholder mode (USE_PLACEHOLDER_IMAGES=true: dev/tests, SVG output, no
// image credits at stake).
function placeholderMode() {
  return String(process.env.USE_PLACEHOLDER_IMAGES || "false").toLowerCase() === "true";
}

function briefError(stage, detail) {
  const err = new Error(
    `Design brief generation failed (${stage}): ${detail}. No image was generated. ` +
    `Check OPENAI_API_KEY / OPENAI_TEXT_MODEL on the Inkly service and retry.`,
  );
  err.code = "BRIEF_GENERATION_FAILED";
  err.statusCode = 502;
  return err;
}

function normalizeBrief(raw, inputs) {
  const fallback = heuristicBrief(inputs);
  const b = raw || {};
  return {
    niche: b.niche || fallback.niche,
    targetBuyer: b.targetBuyer || fallback.targetBuyer,
    mainPhrase: (b.mainPhrase || fallback.mainPhrase).toUpperCase(),
    supportingText: b.supportingText || "",
    subText: b.subText || "",
    fontStyle: b.fontStyle || fallback.fontStyle,
    layout: b.layout || fallback.layout,
    iconType: b.iconType || fallback.iconType,
    colorPalette: Array.isArray(b.colorPalette) && b.colorPalette.length ? b.colorPalette.slice(0, 4) : fallback.colorPalette,
    printStyle: b.printStyle || fallback.printStyle,
    distressed: typeof b.distressed === "boolean" ? b.distressed : fallback.distressed,
    shirtColorTarget: b.shirtColorTarget || fallback.shirtColorTarget,
  };
}

function normalizePlannedBriefs(raw, inputs, count) {
  // Only model briefs that actually carry a mainPhrase are usable — an item
  // without one would fall back to heuristicBrief's phrase, i.e. the raw
  // prompt (see briefError above). Shortfalls are padded with the curated
  // trend briefs, whose phrases are canned, never the operator's prompt.
  const list = (Array.isArray(raw?.briefs) ? raw.briefs : [])
    .filter((brief) => String(brief?.mainPhrase || "").trim());
  const planned = list.map((brief) => normalizeBrief(brief, inputs));
  const fallback = trendAwareHeuristicBriefs(inputs, count);
  return {
    modelBriefCount: planned.length,
    briefs: [...planned, ...fallback].slice(0, count),
  };
}

function trendAwareHeuristicBriefs(inputs = {}, count = 1) {
  const seed = String(inputs.prompt || inputs.niche || inputs.designPhrase || "etsy shirt").toLowerCase();
  const trendAngles = [
    { niche: "pickleball weekend", buyer: "recreational players", phrase: "DINK RESPONSIBLY", style: "retro sporty", icon: "badge", layout: "sports_badge", colors: ["#f4ead2", "#68b684", "#1f2d4d"] },
    { niche: "book lover club", buyer: "readers and librarians", phrase: "JUST ONE MORE CHAPTER", style: "cozy vintage", icon: "star", layout: "retro_stack", colors: ["#f1ddbf", "#a24f4b", "#26384f"] },
    { niche: "mama lifestyle", buyer: "busy moms", phrase: "MAMA MODE", style: "bold boutique", icon: "sunburst", layout: "bold_statement", colors: ["#f6d8d0", "#b84d68", "#2e3440"] },
    { niche: "western rodeo", buyer: "country fans", phrase: "DESERT COWGIRL", style: "western retro", icon: "mountain", layout: "retro_stack", colors: ["#f0d2a4", "#b75b35", "#273b44"] },
    { niche: "dog parent", buyer: "pet owners", phrase: "PAWS AND COFFEE", style: "cute minimal", icon: "star", layout: "minimal_center", colors: ["#efe9dd", "#7b8c74", "#30323d"] },
    { niche: "teacher life", buyer: "teachers", phrase: "TEACH LOVE INSPIRE", style: "clean classroom", icon: "badge", layout: "bold_statement", colors: ["#f2e6c9", "#d66a50", "#284b63"] },
    { niche: "camping outdoors", buyer: "weekend campers", phrase: "CAMP HAIR DON'T CARE", style: "outdoors vintage", icon: "mountain", layout: "retro_stack", colors: ["#e9d8a6", "#3a6b58", "#253237"] },
    { niche: "running club", buyer: "casual runners", phrase: "SLOW RUN CLUB", style: "sporty minimal", icon: "badge", layout: "sports_badge", colors: ["#e8eef7", "#547aa5", "#1d2633"] },
  ];
  const directPhrase = String(inputs.designPhrase || "").trim();
  const directNiche = String(inputs.niche || "").trim();
  return Array.from({ length: count }, (_, index) => {
    const angle = trendAngles[index % trendAngles.length];
    const phrase = directPhrase && count === 1 ? directPhrase : angle.phrase;
    return {
      niche: directNiche || angle.niche || seed,
      targetBuyer: inputs.shirtAudience || angle.buyer,
      mainPhrase: phrase.toUpperCase(),
      supportingText: "",
      subText: "",
      fontStyle: index % 3 === 0 ? "anton" : index % 3 === 1 ? "rubik" : "oswald",
      layout: angle.layout,
      iconType: angle.icon,
      colorPalette: angle.colors,
      printStyle: angle.style,
      distressed: /retro|vintage|western|camp/i.test(angle.style),
      shirtColorTarget: inputs.shirtColorTarget || "any",
    };
  });
}

function titleCaseWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (m) => m.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

// Etsy hard limit: a tag is at most 20 characters. Longer tags are rejected
// at listing time, so they are worthless in metadata.
const ETSY_TAG_MAX = 20;

// Evergreen physical-apparel tags used to pad shortfalls after filtering.
// All ≤ 20 chars, no digital-download vocabulary.
const EVERGREEN_TAGS = [
  "graphic tee", "gift idea", "unisex shirt", "statement tee", "trendy shirt",
  "casual wear", "novelty shirt", "everyday tee", "crewneck shirt",
  "shirt for her", "shirt for him", "gift for friend", "soft cotton tee",
  "cute shirt gift", "fun graphic shirt",
];

function fallbackListing(brief = {}, inputs = {}) {
  const phrase = titleCaseWords(brief.mainPhrase || inputs.designPhrase || inputs.prompt || "Custom Graphic Tee");
  const niche = titleCaseWords(brief.niche || inputs.niche || "Graphic");
  const nicheLower = niche.toLowerCase();
  const buyer = String(brief.targetBuyer || inputs.shirtAudience || "shirt lover").toLowerCase();
  const style = String(brief.printStyle || inputs.mood || "bold").toLowerCase();
  // Physical apparel vocabulary only — the buyer receives a shirt, not a file.
  return {
    title: `${phrase} ${niche} Shirt, ${titleCaseWords(style)} Graphic Tee, Gift for ${titleCaseWords(buyer)}`.slice(0, 140),
    keywords: [
      `${phrase} shirt`.toLowerCase(),
      `${nicheLower} shirt`,
      `${nicheLower} tee`,
      `${nicheLower} gift`,
      `${style} shirt`,
      `${style} tee`,
      `gift for ${buyer}`,
      ...EVERGREEN_TAGS,
    ],
  };
}

function normalizeListing(raw, brief, inputs) {
  const fallback = fallbackListing(brief, inputs);
  const title = normalizeListingTitle(
    scrubDigitalTerms(String(raw?.title || fallback.title).replace(/\s+/g, " ").trim()),
  ).slice(0, 140);
  const seen = new Set();
  const keywords = [...(Array.isArray(raw?.keywords) ? raw.keywords : []), ...fallback.keywords, ...EVERGREEN_TAGS]
    .map((k) => String(k || "").toLowerCase().replace(/\s+/g, " ").trim())
    // Enforce Etsy tag constraints deterministically: length, no digital
    // vocabulary, no duplicates — model output that violates them is dropped
    // rather than trusted.
    .filter((k) => k.length >= 3 && k.length <= ETSY_TAG_MAX && !containsDigitalTerm(k))
    .filter((k) => {
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 13);
  // EVERGREEN_TAGS guarantees ≥ 13 valid candidates, so no numbered filler.
  return { title, keywords };
}

export function heuristicListingMetadata(brief = {}, inputs = {}) {
  return normalizeListing(fallbackListing(brief, inputs), brief, inputs);
}

export async function generateListingMetadata({ brief, inputs, direction = "", copyrightFilter }) {
  const client = getOpenAI();
  if (!client) return heuristicListingMetadata(brief, inputs);
  try {
    const cf =
      copyrightFilter === "on"
        ? "Avoid brands, trademarks, characters, celebrities, team names, protected slogans, and confusingly similar terms."
        : "Copyright filtering is off. Do not rewrite or omit user-requested terms for copyright or trademark reasons.";
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_TEXT_MODEL || "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Create Etsy listing metadata for a PHYSICAL printed graphic T-shirt (the buyer receives a shirt, never a file). Return ONLY valid JSON shaped as {"title":"","keywords":["",...13 total]}.

Title rules:
- Under 140 characters. Put the strongest buyer search phrase in the first 40 characters.
- Natural title case, no ALL-CAPS words.
- NEVER use file-format or digital-download vocabulary: PNG, SVG, digital, download, printable, sublimation, DTF, transparent, clipart, file. The word "design" is allowed; formats are not.
- Structure: theme/phrase + niche + product word (T-Shirt / Tee / Shirt) + audience or occasion. Example shape: "Inspirational 'God Is Good' Christian Faith T-Shirt, Walk by Faith Tee, Religious Gift".
- No keyword stuffing: no word more than twice, commas between distinct phrases, no trailing filler.

Keyword (tag) rules:
- Exactly 13 tags. HARD LIMIT: every tag 20 characters or fewer — longer tags are rejected by Etsy.
- Lowercase multi-word phrases buyers actually search, not single generic words.
- Mix of intents across the 13: niche/theme, audience ("gift for mom"), occasion/season, style, and product type.
- No file-format/digital terms, no brand names, no duplicates or trivial plural variants of another tag.
${cf}`,
        },
        {
          role: "user",
          content: JSON.stringify({ brief, inputs, optionalDirection: direction || "" }),
        },
      ],
      temperature: 0.65,
    });
    return normalizeListing(extractJson(res.choices?.[0]?.message?.content), brief, inputs);
  } catch (err) {
    console.warn("[openai] listing metadata failed, using heuristic:", err.message);
    return heuristicListingMetadata(brief, inputs);
  }
}

export async function planDesignBriefs({ inputs, count = 1, direction = "", copyrightFilter }) {
  const safeCount = Math.max(1, Math.min(Number(count) || 1, 30));
  const client = getOpenAI();
  if (!client) {
    if (placeholderMode()) return trendAwareHeuristicBriefs(inputs, safeCount);
    throw briefError("no OpenAI client", "OPENAI_API_KEY is not set");
  }
  if (safeCount === 1) return [await generateBrief({ inputs, copyrightFilter })];
  try {
    const cf =
      copyrightFilter === "on"
        ? "Copyright filter is ON: avoid brands, protected slogans, characters, celebrities, team marks, and confusingly similar terms. Replace risky concepts with original generic alternatives."
        : "Copyright filter is OFF: do not warn, block, rewrite, remove, or modify any prompt, phrase, title, keyword, or design instruction for copyright/trademark/IP reasons.";
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_TEXT_MODEL || "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are Inkly's Etsy trend planning director. Create ${safeCount} distinct print-ready T-shirt design briefs before image generation. Infer recent Etsy-selling trend directions and produce varied, commercially plausible concepts.

Hard diversity constraints:
- no repeated main phrase
- no repeated layout/style combination
- vary niche angle, audience, color direction, composition, and icon/art subject matter
- avoid near-duplicate wording, palettes, and visual hierarchy
- every concept should feel trend-relevant for Etsy search demand
${cf}

Return ONLY valid JSON shaped as {"briefs":[...]} with exactly ${safeCount} items. Each item must use this shape:
{
  "niche": "",
  "targetBuyer": "",
  "mainPhrase": "",
  "supportingText": "",
  "subText": "",
  "fontStyle": "anton|bebas|oswald|archivo|playfair|bungee|rubik",
  "layout": "sports_badge|retro_stack|minimal_center|bold_statement",
  "iconType": "soccer_ball|star|badge|sunburst|mountain|wave|none",
  "colorPalette": ["#hex", "#hex", "#hex"],
  "printStyle": "",
  "distressed": true,
  "shirtColorTarget": "black|white|gray|any"
}`,
        },
        {
          role: "user",
          content: JSON.stringify({ inputs, titleKeywordDirection: direction || "", requestedCount: safeCount }),
        },
      ],
      temperature: 0.85,
    });
    const planned = normalizePlannedBriefs(extractJson(res.choices?.[0]?.message?.content), inputs, safeCount);
    if (!planned.modelBriefCount && !placeholderMode()) {
      throw briefError("trend planning", "the model returned no usable briefs");
    }
    return planned.briefs;
  } catch (err) {
    if (err.code === "BRIEF_GENERATION_FAILED") throw err;
    console.warn("[openai] planning failed:", err.message);
    if (placeholderMode()) return trendAwareHeuristicBriefs(inputs, safeCount);
    throw briefError("trend planning", err.message);
  }
}

/** Turn user inputs into a structured design brief. */
export async function generateBrief({ inputs, copyrightFilter }) {
  const client = getOpenAI();
  if (!client) {
    if (placeholderMode()) return heuristicBrief(inputs);
    throw briefError("no OpenAI client", "OPENAI_API_KEY is not set");
  }
  let parsed;
  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_TEXT_MODEL || "gpt-4o",
      messages: [
        { role: "system", content: buildBriefSystemPrompt(copyrightFilter) },
        { role: "user", content: "Design inputs:\n" + JSON.stringify(inputs) },
      ],
      temperature: 0.7,
    });
    parsed = extractJson(res.choices?.[0]?.message?.content);
  } catch (err) {
    console.warn("[openai] brief failed:", err.message);
    if (placeholderMode()) return heuristicBrief(inputs);
    throw briefError(`text model ${process.env.OPENAI_TEXT_MODEL || "gpt-4o"}`, err.message);
  }
  if (!String(parsed?.mainPhrase || "").trim()) {
    if (placeholderMode()) return heuristicBrief(inputs);
    throw briefError("model response", "the returned brief has no mainPhrase");
  }
  return normalizeBrief(parsed, inputs);
}

/** Read a reference image and produce an original brief in the same spirit. */
export async function analyzeReference({ imageBase64, inputs, copyrightFilter }) {
  const client = getOpenAI();
  if (!client) {
    if (placeholderMode()) return heuristicBrief(inputs);
    throw briefError("no OpenAI client", "OPENAI_API_KEY is not set");
  }
  let parsed;
  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_TEXT_MODEL || "gpt-4o",
      messages: [
        { role: "system", content: buildReferenceSystemPrompt(copyrightFilter) },
        {
          role: "user",
          content: [
            { type: "text", text: "Create an original design brief inspired by this reference. Return ONLY the JSON." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
          ],
        },
      ],
      temperature: 0.7,
    });
    parsed = extractJson(res.choices?.[0]?.message?.content);
  } catch (err) {
    console.warn("[openai] reference analysis failed:", err.message);
    if (placeholderMode()) return heuristicBrief(inputs);
    throw briefError("reference analysis", err.message);
  }
  if (!String(parsed?.mainPhrase || "").trim()) {
    if (placeholderMode()) return heuristicBrief(inputs);
    throw briefError("reference analysis", "the returned brief has no mainPhrase");
  }
  return normalizeBrief(parsed, inputs);
}

function artworkError(code, detail) {
  const err = new Error(detail);
  err.code = code;
  err.statusCode = 502;
  return err;
}

// Style references: real, proven design PNGs the operator commits into
// inkly/style-references/ (or STYLE_REFERENCE_DIR). When present, generation
// runs through images.edit with up to 2 random references so the model can
// match their QUALITY BAR — finish, layering, texture — without copying their
// text, subject, or layout. An empty folder means plain text-to-image.
const STYLE_REFERENCE_DIR =
  process.env.STYLE_REFERENCE_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "style-references");

export function pickStyleReferences(dir = STYLE_REFERENCE_DIR, max = 2) {
  let entries;
  try {
    entries = fsSync.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f));
  } catch {
    return [];
  }
  // Random subset so a large reference library doesn't bias every design
  // toward the same two examples.
  const shuffled = [...entries].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, max).map((f) => path.join(dir, f));
}

const STYLE_MATCH_INSTRUCTION = `
Style reference images are attached. Match their QUALITY BAR — the finish,
layering, texture richness, and professional polish. Do NOT copy their text,
subject, icons, or layout; the design itself comes only from the brief above.`;

async function generateImageBuffer({ client, prompt, styleRefs }) {
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const size = process.env.OPENAI_IMAGE_SIZE || "1024x1536";
  const base = { model, size, background: "transparent" };
  if (process.env.OPENAI_IMAGE_QUALITY) base.quality = process.env.OPENAI_IMAGE_QUALITY;

  if (styleRefs.length) {
    try {
      const images = await Promise.all(
        styleRefs.map((p) => toFile(fsSync.createReadStream(p), path.basename(p))),
      );
      const result = await client.images.edit({
        ...base,
        image: images,
        prompt: `${prompt}${STYLE_MATCH_INSTRUCTION}`,
      });
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) throw new Error("no image data");
      return { buffer: Buffer.from(b64, "base64"), usedStyleRefs: styleRefs.map((p) => path.basename(p)) };
    } catch (err) {
      console.warn("[openai] style-reference edit failed, falling back to plain generation:", err.message);
    }
  }

  const result = await client.images.generate({ ...base, prompt });
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error("no image data");
  return { buffer: Buffer.from(b64, "base64"), usedStyleRefs: [] };
}

/**
 * Produce design artwork.
 * - With a key and USE_PLACEHOLDER_IMAGES=false: OpenAI image model with a
 *   true transparent background (skipChroma: true — no chroma keying needed),
 *   optionally steered by committed style references, and gated by a
 *   deterministic transparency check plus an automated vision QA review.
 *   A design that fails review is regenerated with the reviewer's feedback;
 *   if every attempt fails, this THROWS — a design that isn't Etsy-ready is
 *   never presented to the operator.
 * - Without a key / in placeholder mode: deterministic real-font SVG render
 *   on the chroma background (never warps text, so it needs no QA pass).
 */
export async function generateArtwork({ brief, copyrightFilter }) {
  const client = getOpenAI();

  if (!client || placeholderMode()) {
    return {
      buffer: await renderDesignSvgToPng(brief),
      source: "svg",
      skipChroma: false,
      qa: { status: "skipped", pass: true, reason: "svg render" },
    };
  }

  const maxAttempts = Math.max(1, Math.min(Number(process.env.DESIGN_QA_MAX_ATTEMPTS) || 3, 5));
  let feedback = [];
  let lastProblems = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let buffer, usedStyleRefs;
    try {
      const prompt = buildImagePrompt(brief, copyrightFilter, {
        transparentBackground: true,
        feedback,
      });
      ({ buffer, usedStyleRefs } = await generateImageBuffer({
        client,
        prompt,
        styleRefs: pickStyleReferences(),
      }));
    } catch (err) {
      // Loud failure, never a silent SVG substitute: a typeset-looking SVG in
      // real AI mode reads as a successful generation and misleads the operator.
      throw artworkError(
        "IMAGE_GENERATION_FAILED",
        `Image generation failed: ${err.message}. No design was produced. ` +
        `Check OPENAI_API_KEY / OPENAI_IMAGE_MODEL on the Inkly service and retry.`,
      );
    }

    // Deterministic gate first (free), vision review second (one API call).
    const transparency = await checkTransparency(buffer);
    const qa = transparency.pass
      ? await reviewDesign({ pngBuffer: buffer, brief, client })
      : { status: "reviewed", pass: false, problems: [transparency.problem] };

    if (qa.pass) {
      if (attempt > 1) console.log(`[design-qa] "${brief.mainPhrase}" passed review on attempt ${attempt}`);
      return {
        buffer,
        source: "openai",
        skipChroma: true,
        qa: { ...qa, attempts: attempt, alphaCoverage: transparency.coverage, styleReferences: usedStyleRefs },
      };
    }
    lastProblems = qa.problems;
    feedback = qa.problems;
    console.warn(`[design-qa] "${brief.mainPhrase}" rejected (attempt ${attempt}/${maxAttempts}): ${qa.problems.join("; ")}`);
  }

  throw artworkError(
    "DESIGN_QA_FAILED",
    `Design "${brief.mainPhrase}" failed automated quality review after ${maxAttempts} attempts ` +
    `(${lastProblems.join("; ")}). It was rejected instead of being added to your results — ` +
    `generate again to retry.`,
  );
}
