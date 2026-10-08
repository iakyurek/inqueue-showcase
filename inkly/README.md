# inkly

AI-assisted tool that produces **clean, centered, high-resolution transparent PNG**
graphics for DTF printing, mockups, Canva, and print-on-demand apparel.

It is not a chatbot. It guides you through a structured flow — upload a reference or
write a prompt — then removes the background, upscales, centers on a 4500×5400
transparent canvas, scores the result, and exports a print-ready PNG.

---

## Quick start

```bash
# 1. install
npm install

# 2. add your key  (this is where the OpenAI API key goes — backend only)
cp .env.example .env
#    then open .env and paste your key into OPENAI_API_KEY=

# 3. run
npm start
#    → http://localhost:5500
```

That's it. The key lives only in `.env` on the server; it is never sent to the
browser. `.env` is git-ignored.

**No key yet?** inkly still runs in **demo mode**: design generation uses a
deterministic real-font SVG renderer (text is never warped), and image cleanup
works fully. Add the key any time to unlock AI briefs, reference vision, and AI art —
just restart (`npm start`), or use `npm run dev` to auto-reload.

---

## Where the key goes (terminal walkthrough)

```bash
cd inkly
cp .env.example .env
nano .env            # or vim/code — set OPENAI_API_KEY=sk-...
npm start
```

Get a key at https://platform.openai.com/api-keys (Platform billing is separate
from ChatGPT Plus).

---

## What each part does

| Path | Role |
| --- | --- |
| `server.js` | Express server + API routes |
| `lib/openaiClient.js` | OpenAI brief / reference vision / image generation, with demo fallbacks (`getOpenAI()` returns `null` when no key) |
| `lib/backgroundRemover.js` | `sharp` chroma-key + edge-connected background removal + trim |
| `lib/upscaler.js` | high-quality Lanczos-3 upscale, with optional Real-ESRGAN super-resolution |
| `lib/exportPng.js` | center on 4500×5400 transparent canvas, 300 DPI, sRGB |
| `lib/svgRender.js` | deterministic real-font badge designs (no-AI path) |
| `lib/qualityEvaluator.js` | scores the export against the quality rubric |
| `lib/copyrightFilter.js` | keyword scan + generic replacement when filter is ON |
| `lib/designRules.js` | house style + prompts + brief schema |
| `public/` | the inkly UI (no build step) |
| `storage/` | uploads + generated outputs (git-ignored) |

---

## Better upscaling (optional)

Lanczos-3 is sharp but it cannot invent detail. For genuine super-resolution on
low-res uploads, enable a model provider in `.env`:

```env
UPSCALE_PROVIDER=replicate
REPLICATE_API_TOKEN=r8_...
UPSCALE_MODEL=nightmareai/real-esrgan
```

inkly will then run Real-ESRGAN first and finish the exact sizing with Lanczos.
Any failure falls back to Lanczos automatically. Swap in another provider by
editing only the fetch block in `lib/upscaler.js`.

---

## API

```
GET  /api/status
POST /api/upload              (multipart: file)         → { jobId, uploadedFile, analysis }
POST /api/process-cleanup     { uploadedFile, copyrightFilter }
POST /api/generate            { designPhrase|prompt|niche…, copyrightFilter, referenceMode? }
GET  /api/jobs/:id
GET  /api/download/:id
```

## Notes

- Output: transparent PNG, 4500×5400, 300 DPI, sRGB, centered with padding.
- Never bakes in mockups, models, or white/gray/chroma boxes.
- Copyright filter OFF disables inkly's checks only — it does not grant rights to
  protected material or override platform policies.
- For best generated typography, install display fonts (Anton, Bebas Neue, Oswald);
  `sharp`/librsvg will pick them up via fontconfig.
