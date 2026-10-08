import sharp from "sharp";

// Deterministic SVG design generator. Renders the main phrase with real fonts
// (system fonts via librsvg/fontconfig) so text is never warped or misspelled —
// this is the no-API generation path and the fallback when OpenAI is absent.
// Output is rendered on the chroma background so the standard cleanup pipeline
// can knock it out to transparency, keeping one consistent export path.

const CHROMA = () => process.env.DESIGN_CHROMA_COLOR || "#FF00FF";

// Map brief fontStyle -> a font stack that resolves on common Linux/macOS boxes.
// (Install Anton/Bebas/Oswald and they'll be picked up automatically.)
const FONT_STACK = {
  anton: "'Anton','Archivo Black','Arial Black',sans-serif",
  bebas: "'Bebas Neue','Oswald','Arial Narrow',sans-serif",
  oswald: "'Oswald','Arial Narrow',sans-serif",
  archivo: "'Archivo Black','Arial Black',sans-serif",
  playfair: "'Playfair Display','Georgia',serif",
  bungee: "'Bungee','Arial Black',sans-serif",
  rubik: "'Rubik','Helvetica',sans-serif",
};

function esc(v) {
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = `${cur} ${w}`.trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

function icon(type, cx, cy, r, fill, accent) {
  switch (type) {
    case "soccer_ball":
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f6f3ea" stroke="${fill}" stroke-width="${r * 0.06}"/>
        <polygon points="${pent(cx, cy, r * 0.34)}" fill="${fill}"/>`;
    case "star":
      return `<polygon points="${starPts(cx, cy, r, r * 0.45, 5)}" fill="${accent}"/>`;
    case "sunburst": {
      let rays = "";
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        rays += `<line x1="${cx + Math.cos(a) * r * 0.5}" y1="${cy + Math.sin(a) * r * 0.5}" x2="${cx + Math.cos(a) * r}" y2="${cy + Math.sin(a) * r}" stroke="${accent}" stroke-width="${r * 0.08}"/>`;
      }
      return rays + `<polygon points="${starPts(cx, cy, r * 0.42, r * 0.18, 5)}" fill="${fill}"/>`;
    }
    case "badge":
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${accent}" stroke-width="${r * 0.1}"/>
        <polygon points="${starPts(cx, cy, r * 0.5, r * 0.22, 5)}" fill="${fill}"/>`;
    case "mountain":
      return `<polygon points="${cx - r},${cy + r * 0.6} ${cx - r * 0.2},${cy - r * 0.6} ${cx + r * 0.2},${cy} ${cx + r * 0.55},${cy - r * 0.4} ${cx + r},${cy + r * 0.6}" fill="${fill}"/>`;
    case "wave":
      return `<path d="M ${cx - r} ${cy} Q ${cx - r / 2} ${cy - r * 0.4}, ${cx} ${cy} T ${cx + r} ${cy}" fill="none" stroke="${accent}" stroke-width="${r * 0.12}" stroke-linecap="round"/>`;
    default:
      return "";
  }
}
function pent(cx, cy, r) {
  let p = [];
  for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5; p.push(`${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`); }
  return p.join(" ");
}
function starPts(cx, cy, R, r, n) {
  let p = [];
  for (let k = 0; k < n * 2; k++) { const rad = k % 2 ? r : R; const a = -Math.PI / 2 + (k * Math.PI) / n; p.push(`${cx + Math.cos(a) * rad},${cy + Math.sin(a) * rad}`); }
  return p.join(" ");
}

export function buildDesignSvg(brief, { size = 1600 } = {}) {
  const W = size, H = size;
  const colors = (brief.colorPalette && brief.colorPalette.length ? brief.colorPalette : ["#f4ead2", "#c0392b", "#1f2d4d"]).slice(0, 4);
  const main = colors[0], accent = colors[1] || colors[0], deep = colors[2] || colors[1] || colors[0];
  const font = FONT_STACK[brief.fontStyle] || FONT_STACK.oswald;
  const phrase = String(brief.mainPhrase || "STAY WILD").toUpperCase();
  const cx = W / 2;
  const layout = brief.layout || "bold_statement";

  let body = "";
  if (layout === "sports_badge") {
    let stars = "";
    for (let k = -2; k <= 2; k++) stars += `<polygon points="${starPts(cx + k * 0.07 * W, H * 0.18, W * 0.022, W * 0.01, 5)}" fill="${accent}"/>`;
    const lines = wrap(phrase, 9);
    const fs = Math.min(W * 0.16, (W * 0.84) / (Math.max(...lines.map((l) => l.length)) * 0.6));
    let txt = "";
    lines.forEach((ln, i) => {
      const y = H * 0.30 + i * fs * 1.02;
      txt += `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${font}" font-size="${fs}" font-weight="900" fill="${main}" stroke="${deep}" stroke-width="${fs * 0.05}" paint-order="stroke">${esc(ln)}</text>`;
    });
    const midY = H * 0.30 + lines.length * fs * 1.02 + W * 0.12;
    body = stars + txt +
      icon(brief.iconType || "soccer_ball", cx, midY, W * 0.085, main, accent) +
      `<line x1="${cx - W * 0.3}" y1="${midY}" x2="${cx - W * 0.13}" y2="${midY}" stroke="${accent}" stroke-width="${W * 0.006}"/>` +
      `<line x1="${cx + W * 0.13}" y1="${midY}" x2="${cx + W * 0.3}" y2="${midY}" stroke="${accent}" stroke-width="${W * 0.006}"/>` +
      (brief.supportingText
        ? `<text x="${cx}" y="${midY + W * 0.18}" text-anchor="middle" font-family="${font}" font-size="${W * 0.07}" font-weight="900" fill="${accent}">${esc(String(brief.supportingText).toUpperCase())}</text>`
        : "");
  } else if (layout === "retro_stack") {
    const lines = wrap(phrase, 8);
    const fs = Math.min(W * 0.15, (W * 0.82) / (Math.max(...lines.map((l) => l.length)) * 0.6));
    body += icon(brief.iconType || "sunburst", cx, H * 0.26, W * 0.14, main, accent);
    let txt = "";
    lines.forEach((ln, i) => {
      const y = H * 0.5 + i * fs;
      txt += `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${font}" font-size="${fs}" font-weight="900" fill="${main}" stroke="${deep}" stroke-width="${fs * 0.05}" paint-order="stroke">${esc(ln)}</text>`;
    });
    body += txt;
  } else if (layout === "minimal_center") {
    const lines = wrap(phrase, 12);
    const fs = Math.min(W * 0.11, (W * 0.78) / (Math.max(...lines.map((l) => l.length)) * 0.55));
    let txt = "";
    lines.forEach((ln, i) => {
      const y = H * 0.48 + i * fs * 1.1;
      txt += `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${font}" font-size="${fs}" font-weight="700" fill="${main}">${esc(ln)}</text>`;
    });
    const by = H * 0.48 + lines.length * fs * 1.1 + W * 0.02;
    body = txt + `<line x1="${cx - W * 0.08}" y1="${by}" x2="${cx + W * 0.08}" y2="${by}" stroke="${accent}" stroke-width="${W * 0.004}"/>`;
  } else {
    if (brief.iconType && brief.iconType !== "none") body += icon(brief.iconType, cx, H * 0.3, W * 0.1, main, accent);
    const lines = wrap(phrase, 10);
    const fs = Math.min(W * 0.16, (W * 0.86) / (Math.max(...lines.map((l) => l.length)) * 0.6));
    let txt = "";
    lines.forEach((ln, i) => {
      const y = H * 0.5 + i * fs * 1.02;
      txt += `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${font}" font-size="${fs}" font-weight="900" fill="${main}" stroke="${deep}" stroke-width="${fs * 0.05}" paint-order="stroke">${esc(ln)}</text>`;
    });
    const by = H * 0.5 + lines.length * fs * 1.02 + W * 0.04;
    body = txt + `<rect x="${cx - W * 0.16}" y="${by}" width="${W * 0.32}" height="${W * 0.01}" rx="${W * 0.005}" fill="${accent}"/>` +
      (brief.supportingText
        ? `<text x="${cx}" y="${by + W * 0.12}" text-anchor="middle" font-family="${font}" font-size="${W * 0.06}" font-weight="900" fill="${accent}">${esc(String(brief.supportingText).toUpperCase())}</text>`
        : "");
  }

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${CHROMA()}"/>
    ${body}
  </svg>`;
}

export async function renderDesignSvgToPng(brief) {
  const svg = buildDesignSvg(brief);
  return await sharp(Buffer.from(svg), { density: 200 }).png().toBuffer();
}
