// inkly design rules — distilled from the build spec (good design, typography,
// color, composition) and the soccer/sports example pack. Used for both the
// OpenAI prompts and the deterministic SVG generator.

export const HOUSE_STYLE_GUIDE = `
inkly DTF / T-shirt house style:
- Clean, centered, print-ready front-chest graphic. Design only — never a mockup,
  model, hanger, wall, product photo, or square poster background.
- Bold, readable typography that still works at thumbnail size. Spell every word
  exactly as requested; no warped, fake, or extra letters.
- 2 to 4 main colors. High contrast, clear color separation, no muddy tones.
- Strong focal point and visual hierarchy: the main phrase is the strongest element.
- Limited palette, thick clean outlines; light distressed/vintage texture is fine
  when the mood calls for it (sports, retro).
- Icons/badges/flags/balls/stars/laurels that support the phrase, never clutter it.
- Works on black, white, and neutral shirt colors. For black shirts use lighter
  inks; for white shirts avoid pure-white fills unless outlined.
- Feels intentional and commercially sellable, not randomly generated.
`;

// Short text garbles far less often in image models, and misspelled shirts
// are unsellable — these limits are load-bearing for Etsy production quality.
export const PHRASE_RULES = `
Phrase rules (hard requirements):
- mainPhrase: 2-6 words, 30 characters max, grammatically correct everyday
  English, spelled exactly as a native speaker would write it.
- supportingText: 0-5 words. subText: 0-4 words. Total words across all three
  text fields: 12 or fewer.
- No punctuation except apostrophes. No hashtags, emoji, or decorative
  unicode. Never invent abbreviations.
`;

export const DESIGN_BRIEF_SCHEMA = `
Return ONLY valid JSON (no markdown fences) with this exact shape:
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
}
`;

export function buildBriefSystemPrompt(copyrightFilter) {
  const cf =
    copyrightFilter === "on"
      ? `Copyright filter is ON: never use copyrighted characters, brand names, sports team or league marks, celebrity likenesses, or protected slogans. Replace any such idea with an ORIGINAL, generic equivalent of similar energy.`
      : `Copyright filter is OFF: do not apply copyright/trademark filtering. Still prioritize print quality and readability.`;
  return `You are inkly's DTF T-shirt art director. Convert the user's inputs into a tight design brief for a CENTERED, print-ready transparent-PNG graphic.
${HOUSE_STYLE_GUIDE}
${PHRASE_RULES}
${cf}
${DESIGN_BRIEF_SCHEMA}`;
}

export function buildReferenceSystemPrompt(copyrightFilter) {
  const extra =
    copyrightFilter === "on"
      ? `Read its niche, mood, palette, layout and typography, then design an ORIGINAL graphic in the same spirit. Do not copy logos, characters, team marks, celebrity likenesses, or wording verbatim.`
      : `Read its niche, mood, palette, layout, typography, and wording direction. Copyright/trademark filtering is off, so do not rewrite, block, warn on, or remove protected terms for IP reasons.`;
  return `${buildBriefSystemPrompt(copyrightFilter)}
Additional: the user provided a REFERENCE image. ${extra}`;
}

export function buildImagePrompt(brief, copyrightFilter, optionsOrFeedback = {}) {
  // Backward-compatible third arg: a bare feedback array or an options object
  // { feedback: [], transparentBackground: bool }.
  const options = Array.isArray(optionsOrFeedback)
    ? { feedback: optionsOrFeedback }
    : (optionsOrFeedback || {});
  const qaFeedback = Array.isArray(options.feedback) ? options.feedback : [];
  const transparentBackground = Boolean(options.transparentBackground);
  const chroma = process.env.DESIGN_CHROMA_COLOR || "#FF00FF";
  const cf =
    copyrightFilter === "on"
      ? `- No copyright/trademark risk: no brand names, team/league logos, characters, celebrities, or protected phrases.`
      : `- Copyright/trademark filtering is disabled for this request.`;
  // Enumerate every word the artwork may contain: image models drop or morph
  // letters ("GOD IS GOOD" -> "GOD I GOOD"), and the strongest known
  // mitigation is an explicit word-by-word checklist plus a no-other-text
  // rule (which also kills the garbled filler lines models add near edges).
  const allWords = [brief.mainPhrase, brief.supportingText, brief.subText]
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
  const spellingChecklist = allWords.map((w) => `"${w}"`).join(", ");
  return `
Create one print-ready T-shirt graphic as an isolated design asset.

Main phrase (spell exactly):
"${brief.mainPhrase || ""}"
${brief.supportingText ? `Supporting text: "${brief.supportingText}"` : ""}
${brief.subText ? `Small sub text: "${brief.subText}"` : ""}

Text accuracy — hard requirements, checked before anything else:
- The artwork contains ONLY the text given above. No other words, letters,
  numbers, watermarks, signatures, or small filler text anywhere, especially
  near the edges.
- Spell every word letter-perfect. Word-by-word checklist: ${spellingChecklist || "(no text)"}.
- Every word complete: no dropped, doubled, merged, or extra letters. "IS"
  must never become "I"; render each word exactly as written.
- If the lettering gets difficult, simplify the decoration — never drop, add,
  or alter a letter.

Layout & spacing — hard requirements:
- NOTHING may cover, clip, touch, or overlap any letter. Icons, badges,
  balls, banners, ribbons, and laurels sit fully ABOVE, BELOW, or BETWEEN
  text lines with clear empty space around every word.
- Each text line sits on its own clear horizontal band; lines never collide
  or crowd each other.
- Nothing is cut off by the canvas edge. Keep a clear empty margin (at least
  6% of the canvas) on all four sides.
- If elements start to crowd, remove decoration or shrink the icon — never
  sacrifice text spacing or legibility.

Retail-grade finish — this must look like a professional shirt graphic:
- Layered, dimensional lettering: outlines, offset shadows, inline highlights
  — never flat single-weight default-looking text.
- Subtle print texture where the mood fits (light distress, halftone, grain).
- Supporting ornament (badge frames, stars, laurels, sunbursts, banners)
  executed cleanly and deliberately.
- Never flat basic clip art; every element looks designed, not defaulted.
${qaFeedback.length ? `
A previous attempt at this design was REJECTED by quality review for these
exact defects — you must fix every one of them:
${qaFeedback.map((p) => `- ${p}`).join("\n")}
` : ""}
Direction:
- Niche: ${brief.niche || "general apparel"}
- Style/mood: ${brief.printStyle || "bold"}; layout: ${brief.layout || "bold_statement"}
- Palette: ${(brief.colorPalette || []).join(", ")}
${HOUSE_STYLE_GUIDE}

Output requirements:
- Design only. No model, hanger, folded shirt, room, or poster background.
- Centered front-chest composition with clean margins.
${transparentBackground
    ? `- Fully TRANSPARENT background (true alpha). No background panel, plate,
  color field, scene, or texture behind the artwork — only the design itself.`
    : `- Generate on a perfectly flat single-color chroma background: ${chroma}.
- Do NOT use ${chroma} anywhere inside the artwork.
- The backend removes the chroma background and exports a transparent PNG.`}
- No gradients bleeding into the background, no borders around the canvas.
- Bold, correctly spelled text; 2-4 colors; readable at thumbnail size.
${cf}
`;
}

export function heuristicBrief(inputs) {
  const phrase = (inputs.designPhrase || inputs.prompt || inputs.niche || "Stay Wild").trim();
  const mood = (inputs.mood || "").toLowerCase();
  const blob = `${inputs.niche || ""} ${inputs.prompt || ""} ${mood}`.toLowerCase();
  let fontStyle = "oswald", layout = "bold_statement", iconType = "star", distressed = false;

  if (/sport|soccer|team|athlet|game|league|cup|match/.test(blob)) {
    fontStyle = "anton"; layout = "sports_badge"; iconType = "soccer_ball";
  }
  if (/retro|vintage|distress/.test(mood)) {
    layout = "retro_stack"; fontStyle = "anton"; distressed = true; iconType = "sunburst";
  }
  if (/minimal|clean|luxury|professional/.test(mood)) {
    layout = "minimal_center"; fontStyle = /luxury/.test(mood) ? "playfair" : "rubik"; iconType = "none";
  }
  if (/street/.test(mood)) { fontStyle = "bungee"; layout = "bold_statement"; }

  let palette = ["#f4ead2", "#c0392b", "#1f2d4d"];
  const pref = (inputs.colorPreference || "").toLowerCase();
  const shirt = inputs.shirtColorTarget || "black";
  if (shirt === "white") palette = ["#1f2d4d", "#c0392b", "#2c3e50"];
  if (/vintage|retro/.test(mood)) palette = ["#efe2c4", "#bd4b3b", "#274060"];
  if (/sunset|orange|warm/.test(pref)) palette = ["#f6d8b0", "#e0653a", "#7a2f2f"];
  if (/black|dark/.test(pref)) palette = ["#e8e8e8", "#cdd4e0", "#9aa3b3"];

  return {
    niche: inputs.niche || "general apparel",
    targetBuyer: inputs.shirtAudience || "everyday wearers",
    mainPhrase: phrase.toUpperCase(),
    supportingText: "",
    subText: "",
    fontStyle, layout, iconType,
    colorPalette: palette,
    printStyle: mood || "bold",
    distressed,
    shirtColorTarget: shirt,
  };
}
