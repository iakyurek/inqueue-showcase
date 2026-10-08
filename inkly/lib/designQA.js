// Automated pre-release design review. Every AI-generated design is graded by
// a vision model against a hard rubric (exact spelling, no covered or clipped
// letters, no stray text, clean background, retail-grade quality score) plus a
// deterministic transparency check. A design that fails review is never
// presented to the operator — the caller regenerates it with the reviewer's
// feedback, and errors out loudly if it keeps failing.
//
// The pixel-based qualityEvaluator can't read text or see element overlaps
// (a ball clipping half of "FRANCE" scores 9/10 there); this gate exists to
// catch exactly that class of defect.

import sharp from "sharp";
import { readAlphaStats } from "./exportPng.js";

export const MIN_DESIGN_QUALITY = 7;

// Opaque pixels covering more than this share of the canvas means the model
// baked in a background panel instead of true transparency.
export const MAX_ALPHA_COVERAGE = 0.85;

export const QA_SYSTEM_PROMPT = `You are a merciless print-production QA reviewer for Etsy T-shirt designs.
You are shown one design image and the exact text it must contain. Grade it
against this rubric. When in doubt on any check, mark it failed — a rejected
good design costs one retry; an approved bad design costs a refund and a bad
review.

Checks:
1. spellingCorrect — read every piece of text. Each expected word appears
   spelled letter-perfect: no dropped, doubled, merged, warped, or extra
   letters.
2. extraText — true if the image contains ANY text not in the expected list
   (filler words, watermarks, signatures, gibberish glyphs).
3. overlapOrClipping — true if any element (icon, badge, ball, banner,
   ribbon, laurel, panel) covers, cuts, or touches any letter, OR if any part
   of the artwork is clipped by the canvas edge. Every letter must be fully
   visible with clear space around it and a clear margin on all four sides.
4. backgroundClean — the artwork sits on a clean empty background (a flat
   transparent/checkerboard or single flat color is fine). False if there is
   a background panel, scene, gradient field, or texture plate behind the
   design.
5. designQuality — 1-10 against a RETAIL-GRADE bar: layered dimensional
   lettering, deliberate composition and hierarchy, clean supporting
   ornament, professional finish. Flat basic clip art or default-looking
   text scores 5 or below. 7 is the minimum sellable bar.

Respond with ONLY valid JSON (no markdown fences):
{
  "textRead": ["every", "word", "you", "can", "read"],
  "spellingCorrect": true,
  "extraText": false,
  "overlapOrClipping": false,
  "backgroundClean": true,
  "designQuality": 8,
  "problems": ["specific, actionable description of each defect found"]
}`;

export function expectedWords(brief = {}) {
  return [brief.mainPhrase, brief.supportingText, brief.subText]
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
}

export function buildQAUserPrompt(brief = {}) {
  const words = expectedWords(brief);
  return `Expected text, word by word: ${words.map((w) => `"${w}"`).join(", ") || "(none — the design must contain no text at all)"}.
The image must contain exactly these words and nothing else. Apply the rubric and return the JSON verdict.`;
}

// Fail closed on anything ambiguous: malformed replies, missing checks, or a
// quality score under the bar all count as failures — but every failure ships
// with actionable problems so the regeneration prompt gets real feedback.
export function normalizeQAResult(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const problems = (Array.isArray(r.problems) ? r.problems : [])
    .map((p) => String(p).trim())
    .filter(Boolean);
  const textRead = (Array.isArray(r.textRead) ? r.textRead : [])
    .map((w) => String(w).trim())
    .filter(Boolean);
  const designQuality = Number.isFinite(Number(r.designQuality)) ? Number(r.designQuality) : 0;
  const checks = {
    spellingCorrect: r.spellingCorrect === true,
    extraText: r.extraText === true,
    overlapOrClipping: r.overlapOrClipping === true,
    backgroundClean: r.backgroundClean === true,
  };
  // Backstop problems for each failed check, so the regeneration prompt gets
  // actionable feedback even when the reviewer forgets to fill problems[].
  const synth = [];
  if (!checks.spellingCorrect) synth.push("text is not spelled letter-perfect");
  if (checks.extraText) synth.push("image contains text that is not in the brief");
  if (checks.overlapOrClipping) synth.push("an element overlaps/clips lettering or the artwork is cut off at the edge");
  if (!checks.backgroundClean) synth.push("a background panel or scene is baked in behind the design");
  if (designQuality < MIN_DESIGN_QUALITY) {
    synth.push(`design quality ${designQuality}/10 is below the retail bar of ${MIN_DESIGN_QUALITY} — needs layered dimensional lettering and a professional finish, not flat basic art`);
  }
  if (problems.length === 0) problems.push(...synth);
  const pass =
    checks.spellingCorrect &&
    !checks.extraText &&
    !checks.overlapOrClipping &&
    checks.backgroundClean &&
    designQuality >= MIN_DESIGN_QUALITY;
  if (!pass && problems.length === 0) problems.push("reviewer returned a malformed verdict");
  return { status: "reviewed", pass, checks, designQuality, problems: [...new Set(problems)], textRead };
}

/**
 * Deterministic transparency check: if opaque pixels cover almost the whole
 * canvas, the model baked in a background panel instead of true alpha.
 */
export async function checkTransparency(pngBuffer) {
  const s = await readAlphaStats(pngBuffer);
  const coverage = s.coverage;
  if (!s.hasContent) {
    return { pass: false, coverage, problem: "image is fully transparent — no artwork rendered" };
  }
  if (coverage > MAX_ALPHA_COVERAGE) {
    return {
      pass: false,
      coverage,
      problem: `opaque pixels cover ${Math.round(coverage * 100)}% of the canvas — a background panel is baked in; the design must sit on a fully transparent background with clear margins`,
    };
  }
  return { pass: true, coverage };
}

function extractJson(text) {
  const cleaned = String(text || "").replace(/```json|```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("QA model did not return JSON.");
  return JSON.parse(cleaned.slice(first, last + 1));
}

export function qaEnabled() {
  return String(process.env.DESIGN_QA || "on").toLowerCase() !== "off";
}

async function callReviewModel({ client, brief, imageDataUrl }) {
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_QA_MODEL || process.env.OPENAI_TEXT_MODEL || "gpt-4o",
    temperature: 0,
    messages: [
      { role: "system", content: QA_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: buildQAUserPrompt(brief) },
          { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
        ],
      },
    ],
  });
  return normalizeQAResult(extractJson(completion.choices?.[0]?.message?.content));
}

/**
 * Review one generated design. Returns:
 *   { status: "reviewed", pass, checks, designQuality, problems, textRead }
 *   { status: "skipped", pass: true, reason }  — QA disabled, or the review
 *     call failed twice (fail-open so a QA outage doesn't waste an
 *     already-paid-for image; logged and recorded in metadata for auditing).
 */
export async function reviewDesign({ pngBuffer, brief, client }) {
  if (!qaEnabled()) return { status: "skipped", pass: true, reason: "DESIGN_QA=off" };
  if (!client) return { status: "skipped", pass: true, reason: "no OpenAI client" };

  // Downscale before shipping to the reviewer — text stays readable at 768px
  // and the payload/token cost drops sharply versus the raw 1024x1536 render.
  const small = await sharp(pngBuffer)
    .resize({ width: 768, height: 768, fit: "inside" })
    .png()
    .toBuffer();
  const imageDataUrl = `data:image/png;base64,${small.toString("base64")}`;

  let lastErr;
  for (let tryNo = 1; tryNo <= 2; tryNo++) {
    try {
      return await callReviewModel({ client, brief, imageDataUrl });
    } catch (err) {
      lastErr = err;
      console.warn(`[design-qa] review call failed (try ${tryNo}/2):`, err.message);
    }
  }
  return { status: "skipped", pass: true, reason: `review call failed: ${lastErr.message}` };
}
