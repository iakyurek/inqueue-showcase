import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { fileURLToPath } from "url";
import {
  getSessionFromRequest,
  isPublicPath,
  clearSessionCookieHeader,
} from "../lib/auth.js";
import {
  verifySsoTicket,
  newToolSessionCookieHeader,
  getToolSessionFromRequest,
  buildToolLaunchRedirect,
  sanitizeNextPath,
} from "../lib/sso.js";

import {
  ensureBaseDirs, ensureJobDir, jobPaths, writeJson, readJson,
  UPLOADS_DIR, OUTPUTS_DIR, newJobId, safeSlug,
} from "./lib/fileStore.js";
import { generateBrief, analyzeReference, generateArtwork, getOpenAI, generateListingMetadata, planDesignBriefs } from "./lib/openaiClient.js";
import { makeTransparentPng, backgroundProviderStatus } from "./lib/backgroundRemover.js";
import { upscale } from "./lib/upscaler.js";
import { runCleanupPipeline } from "./lib/cleanupPipeline.js";
import { composeTransparent, alphaStatsFromRaw } from "./lib/exportPng.js";
import { createScheduler, makeSemaphore } from "./lib/designScheduler.js";
import { evaluate } from "./lib/qualityEvaluator.js";
import { filterInputs } from "./lib/copyrightFilter.js";
import { createZip } from "./lib/zipBuilder.js";
import { normalizeReadyPng, READY_PNG_LIMITS } from "./lib/normalizePng.js";
import { normalizeListingTitle } from "./lib/listingTitle.js";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 5500);
const HUB_URL = process.env.INQUEUE_HUB_URL || "http://localhost:4000";
const generationJobs = new Map();
// Design-level fair scheduler: every job's designs share one global pool of
// concurrent slots, so a solo 15-design job uses all of them instead of
// running sequentially, while a teammate's job gets slots as soon as any
// design finishes. A design's generate -> QA -> retry chain still never
// interleaves — it occupies one slot start to finish.
const DESIGN_CONCURRENCY = Math.max(1, Math.min(Number(process.env.INKLY_DESIGN_CONCURRENCY) || 3, 6));
if (process.env.INKLY_GENERATION_LANES) {
  console.warn("[inkly] INKLY_GENERATION_LANES is deprecated and ignored — set INKLY_DESIGN_CONCURRENCY (designs in flight, default 3).");
}
const designScheduler = createScheduler({ maxConcurrent: DESIGN_CONCURRENCY });
// The finishing tail of each design allocates a 4500x5400 RGBA canvas
// (~97 MB raw) plus upscaler working buffers; serializing just that stage
// keeps peak memory flat on a 512 MB instance while the network-bound
// OpenAI calls overlap freely.
const composeSemaphore = makeSemaphore(Math.max(1, Math.min(Number(process.env.INKLY_COMPOSE_CONCURRENCY) || 1, 4)));
// Normalizing a ready PNG can decode a 16000px-per-side image; parallel
// client uploads must not stack those decodes.
const normalizeSemaphore = makeSemaphore(2);

// Load the shared inQueue session secret from the root .env.local if present.
// Inkly needs INQUEUE_SESSION_SECRET (only) to verify cookies signed by the hub.
function loadRootEnv() {
  const rootEnv = path.join(__dirname, "..", ".env.local");
  if (!fsSync.existsSync(rootEnv)) return;
  for (const line of fsSync.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const key = t.slice(0, i).trim();
    if (!key.startsWith("INQUEUE_")) continue;
    let value = t.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadRootEnv();

await ensureBaseDirs();

// --------------------------------------------------------------------------
// Auth gate. Every request except a small exempt set requires a valid inQueue
// session cookie. Unauthenticated page requests → 302 to the hub /login;
// unauthenticated /api/* requests → 401 JSON. Local /api/logout clears the
// cookie so the tool has a logout button that doesn't require a hub round-trip.
// --------------------------------------------------------------------------
// Public config snippet — lets the frontend build hub links (logout, back to
// hub) without a hard-coded localhost:4000. Served pre-auth so the redirect
// on 401 also works if we ever inline the config into the login page.
app.get("/config.js", (_req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(`window.INQUEUE_CONFIG = ${JSON.stringify({ hubUrl: HUB_URL })};\n`);
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookieHeader());
  res.json({ ok: true });
});
app.get("/api/auth/status", (req, res) => {
  const session = getSessionFromRequest(req) || getToolSessionFromRequest(req, "inkly");
  res.json({ authenticated: Boolean(session), username: session?.u || null });
});

// SSO callback — the hub bounces the browser here with a ticket. Verify it for
// this tool, set a first-party browser-session cookie, and continue to `next`.
// Public (registered before the gate) because the ticket IS the credential.
app.get("/auth/sso/callback", (req, res) => {
  const ticket = typeof req.query.ticket === "string" ? req.query.ticket : "";
  const payload = verifySsoTicket(ticket, "inkly");
  if (!payload) {
    // Malformed / expired / wrong-tool ticket → restart the launch so the hub
    // re-checks auth and mints a fresh one. Never trust an unverified ticket.
    return res.redirect(302, buildToolLaunchRedirect("inkly", "/", HUB_URL));
  }
  res.setHeader("Set-Cookie", newToolSessionCookieHeader("inkly", payload.u));
  return res.redirect(302, sanitizeNextPath(payload.next) || "/");
});

app.use((req, res, next) => {
  if (isPublicPath(req.path)) return next();
  // Accept the hub's shared cookie (same-origin/local dev) OR this tool's own
  // first-party SSO session (the only cookie present cross-origin on Render).
  if (getSessionFromRequest(req) || getToolSessionFromRequest(req, "inkly")) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "UNAUTHENTICATED" });
  const currentPath = req.originalUrl || req.url;
  return res.redirect(302, buildToolLaunchRedirect("inkly", currentPath, HUB_URL));
});

// Set to true to re-enable the Clean Up Existing Design feature.
// Backend code and pipeline are preserved; only access is gated here.
const CLEANUP_FEATURE_ENABLED = false;

app.use(express.json({ limit: "16mb" }));
app.use(express.urlencoded({ extended: true }));

// ---- uploads ---------------------------------------------------------------
const uploadStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => { await fs.mkdir(UPLOADS_DIR, { recursive: true }); cb(null, UPLOADS_DIR); },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    cb(null, `${Date.now()}-${safeSlug(path.basename(file.originalname, ext))}${ext}`);
  },
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /image\/(png|jpe?g|webp)/.test(file.mimetype)),
});
// Ready PNGs stay in memory: the handler only needs the buffer, and skipping
// the disk write+read round trip matters when the client uploads 3 at a time.
const pngUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: READY_PNG_LIMITS.maxBytes },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === "image/png"),
});

function outputUrl(jobId) { return `/outputs/${jobId}/design.png`; }

// Shared finishing pipeline: cleanup -> upscale -> compose -> evaluate -> save.
async function finishAndSave({ jobId, designBuffer, skipChroma, ctx }) {
  const paths = await ensureJobDir(jobId);
  return composeSemaphore(async () => {
    const transparent = await makeTransparentPng(designBuffer, { skipChroma });
    const beforeMeta = await sharp(transparent).metadata();
    const { buffer: upscaled, method } = await upscale(transparent);
    const wasUpscaled = method !== "none";
    const finalPng = await composeTransparent(upscaled);

    await fs.writeFile(paths.output, finalPng);
    const quality = await evaluate(finalPng, { ...ctx, upscaleMethod: method, wasUpscaled });

    const metadata = {
      id: jobId,
      created_at: new Date().toISOString(),
      ...ctx,
      sourceLongEdge: Math.max(beforeMeta.width || 0, beforeMeta.height || 0),
      upscaleMethod: method,
      output_url: outputUrl(jobId),
      quality,
    };
    await writeJson(paths.metadata, metadata);
    return metadata;
  });
}

async function cleanupWithProvidersAndSave({ jobId, designBuffer, filename, ctx }) {
  const paths = await ensureJobDir(jobId);

  // Run the staged cleanup pipeline:
  //   preprocess → bg removal (conditional) → post-clean → alpha-aware upscale
  const { transparent, provider, upscaleMethod, skippedBgRemoval, sourceLongEdge } =
    await runCleanupPipeline(designBuffer, { filename });

  const finalPng = await composeTransparent(transparent);

  await fs.writeFile(paths.output, finalPng);
  const quality = await evaluate(finalPng, {
    ...ctx,
    backgroundProvider: provider,
    upscaleMethod,
    wasUpscaled: upscaleMethod !== "none",
  });
  const metadata = {
    id: jobId,
    created_at: new Date().toISOString(),
    ...ctx,
    sourceLongEdge,
    backgroundProvider: provider,
    skippedBgRemoval,
    upscaleMethod,
    output_url: outputUrl(jobId),
    quality,
  };
  await writeJson(paths.metadata, metadata);
  return metadata;
}

async function saveReadyPng({ jobId, designBuffer, originalName }) {
  const paths = await ensureJobDir(jobId);
  // Standardize to 8-bit RGBA sRGB, non-interlaced, metadata stripped —
  // file-specific PNG oddities are converted here instead of failing later.
  const { buffer: normalizedBuffer, meta, normalized, alphaRaw } =
    await normalizeSemaphore(() => normalizeReadyPng(designBuffer));
  await fs.writeFile(paths.output, normalizedBuffer);
  // Opaque-coverage stat: normalization ADDS an alpha channel to fully opaque
  // uploads (e.g. an accidental screenshot), so hasAlpha alone can't catch
  // them — the client asks for confirmation above the threshold.
  let alphaStats = null;
  try {
    alphaStats = alphaRaw ? alphaStatsFromRaw(alphaRaw) : null;
  } catch {
    alphaStats = null;
  }
  const metadata = {
    id: jobId,
    created_at: new Date().toISOString(),
    mode: "uploaded_ready_png",
    inputMode: "upload",
    originalName,
    hasAlpha: meta.hasAlpha,
    alphaCoverage: alphaStats ? Math.round(alphaStats.coverage * 100) / 100 : null,
    width: meta.width,
    height: meta.height,
    originalBytes: designBuffer.length,
    normalizedBytes: normalizedBuffer.length,
    normalization: normalized,
    output_url: outputUrl(jobId),
  };
  await writeJson(paths.metadata, metadata);
  return metadata;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildManifest(items) {
  const headers = ["design_id", "design_file", "title_description", "keywords"];
  const rows = items.map((item, index) => {
    const designId = `D${String(index + 1).padStart(3, "0")}`;
    const designFile = `designs/${designId}.png`;
    const keywords = item.keywords.join("|");
    return [
      designId,
      designFile,
      normalizeListingTitle(item.title),
      keywords,
    ].map(csvCell).join(",");
  });
  return `${headers.join(",")}\n${rows.join("\n")}\n`;
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    // Designs finish out of order under the scheduler; expose them compacted
    // in original brief order so the client's progressive list stays stable.
    results: (job.resultSlots || []).filter(Boolean),
    errors: job.errors,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

async function generateOneProject({ brief, inputs, metadataDirection, copyrightFilter, copyrightHits, mode = "prompt", inputMode = "prompt" }) {
  console.log(`[inkly] OpenAI generation started — phrase: "${brief.mainPhrase}", layout: ${brief.layout}, aiEnabled: ${Boolean(getOpenAI())}`);
  // Listing metadata (text) and artwork (image + QA) are independent —
  // overlap them to save a full text-model round trip per design.
  const [listing, { buffer: artwork, source, qa, skipChroma }] = await Promise.all([
    generateListingMetadata({
      brief,
      inputs,
      direction: metadataDirection || "",
      copyrightFilter,
    }),
    generateArtwork({ brief, copyrightFilter }),
  ]);
  console.log(`[inkly] OpenAI result — source: ${source}, buffer size: ${artwork.length} bytes, qa: ${qa?.status || "n/a"}${qa?.attempts ? ` (attempts: ${qa.attempts})` : ""}`);
  const id = newJobId(brief.mainPhrase || "design");
  console.log(`[inkly] Cleanup pipeline started — jobId: ${id}, skipChroma: ${skipChroma ?? (source !== "openai" && source !== "svg")}`);
  const meta = await finishAndSave({
    jobId: id,
    designBuffer: artwork,
    skipChroma: skipChroma ?? (source !== "openai" && source !== "svg"),
    ctx: {
      mode,
      inputMode,
      copyrightFilter,
      copyrightHits,
      artworkSource: source,
      designReview: qa,
      brief,
      listing,
    },
  });
  console.log(`[inkly] Cleanup pipeline completed — output_url: ${meta.output_url}`);
  return meta;
}

async function referenceBriefFromUpload({ uploadedFile, inputs, copyrightFilter }) {
  const filePath = path.join(UPLOADS_DIR, path.basename(uploadedFile));
  const imgBuf = await fs.readFile(filePath);
  const b64 = (await sharp(imgBuf)
    .resize({ width: 768, height: 768, fit: "inside" })
    .jpeg({ quality: 80 })
    .toBuffer()).toString("base64");
  return await analyzeReference({ imageBase64: b64, inputs, copyrightFilter });
}

function startGenerationJob({ rawInputs, count, metadataDirection, copyrightFilter, copyrightHits, referenceMode = null, uploadedFile = null }) {
  const job = {
    id: newJobId("generation-job"),
    status: "queued",
    total: Math.max(1, Math.min(Number(count) || 1, 30)),
    completed: 0,
    failed: 0,
    resultSlots: [],
    errors: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  generationJobs.set(job.id, job);

  (async () => {
    try {
      job.status = "generating";
      job.updated_at = new Date().toISOString();
      const isSimilar = referenceMode === "similar_new_design" && uploadedFile;
      const briefs = isSimilar
        ? [await referenceBriefFromUpload({ uploadedFile, inputs: rawInputs, copyrightFilter })]
        : await planDesignBriefs({
            inputs: rawInputs,
            count: job.total,
            direction: metadataDirection || "",
            copyrightFilter,
          });
      const tasks = Array.from({ length: job.total }, (_, index) => async () => {
        try {
          const project = await generateOneProject({
            brief: briefs[index],
            inputs: rawInputs,
            metadataDirection,
            copyrightFilter,
            copyrightHits,
            mode: isSimilar ? "similar_new_design" : "prompt",
            inputMode: isSimilar ? "upload" : "prompt",
          });
          job.resultSlots[index] = project;
          job.completed += 1;
        } catch (err) {
          console.error("[generation job] item failed:", err);
          job.failed += 1;
          job.errors.push(err.message || `Design ${index + 1} failed.`);
        }
        job.updated_at = new Date().toISOString();
      });
      await designScheduler.submitJob(job.id, tasks);
      job.status = job.completed > 0 ? "completed" : "failed";
      job.updated_at = new Date().toISOString();
    } catch (err) {
      console.error("[generation job] failed:", err);
      job.status = "failed";
      job.errors.push(err.message || "Generation queue failed.");
      job.updated_at = new Date().toISOString();
    }
  })().catch((err) => {
    console.error("[generation queue] unexpected failure:", err);
  });

  return job;
}

// ---- API -------------------------------------------------------------------
app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    aiEnabled: Boolean(getOpenAI()),
    superResolution: process.env.UPSCALE_PROVIDER === "replicate" && Boolean(process.env.REPLICATE_API_TOKEN),
    backgroundProviders: backgroundProviderStatus(),
    canvas: {
      width: Number(process.env.DEFAULT_CANVAS_WIDTH || 4500),
      height: Number(process.env.DEFAULT_CANVAS_HEIGHT || 5400),
      dpi: Number(process.env.EXPORT_DPI || 300),
    },
  });
});

// Upload a reference image; return analysis.
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded." });
    const meta = await sharp(req.file.path).metadata();
    const jobId = newJobId("upload");
    res.json({
      jobId,
      uploadedFile: path.basename(req.file.path),
      analysis: {
        width: meta.width, height: meta.height,
        needsUpscaling: Math.max(meta.width || 0, meta.height || 0) < 3000,
        hasAlpha: Boolean(meta.hasAlpha),
        format: meta.format,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Upload failed" });
  }
});

// Exact File Cleanup — process the uploaded file as-is (no AI redraw).
app.post("/api/process-cleanup", async (req, res) => {
  if (!CLEANUP_FEATURE_ENABLED) {
    return res.status(503).json({ error: "Clean Up Existing Design is temporarily offline." });
  }
  try {
    const { jobId, uploadedFile, copyrightFilter = "on" } = req.body || {};
    if (!uploadedFile) return res.status(400).json({ error: "Missing uploaded file reference." });
    const filePath = path.join(UPLOADS_DIR, path.basename(uploadedFile));
    const buffer = await fs.readFile(filePath);
    const id = jobId || newJobId("cleanup");
    const metadata = await cleanupWithProvidersAndSave({
      jobId: id,
      designBuffer: buffer,
      filename: uploadedFile,
      ctx: { mode: "exact_cleanup", inputMode: "upload", copyrightFilter },
    });
    res.json({ ok: true, project: metadata });
  } catch (err) {
    console.error(err);
    const status = err.code === "MISSING_BACKGROUND_PROVIDER" ? 400 : 500;
    res.status(status).json({ error: err.message || "Cleanup failed", code: err.code || "CLEANUP_FAILED" });
  }
});

app.post("/api/upload-ready-png", (req, res) => {
  // Invoke multer in callback form so its errors (notably LIMIT_FILE_SIZE)
  // become clean JSON instead of an HTML error page the client can't parse.
  pngUpload.single("file")(req, res, async (multerErr) => {
    if (multerErr) {
      const limitMb = Math.round(READY_PNG_LIMITS.maxBytes / (1024 * 1024));
      if (multerErr.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: `This PNG is larger than the ${limitMb} MB upload limit. Export a smaller PNG and try again.` });
      }
      console.error(multerErr);
      return res.status(400).json({ error: multerErr.message || "Upload failed." });
    }
    try {
      if (!req.file) return res.status(400).json({ error: "Upload a PNG file." });
      const id = newJobId("ready-png");
      const metadata = await saveReadyPng({ jobId: id, designBuffer: req.file.buffer, originalName: req.file.originalname });
      res.json({ ok: true, project: metadata });
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({ error: err.message || "Ready PNG upload failed" });
    }
  });
});

// Generate from a prompt, or "Create Similar New Design" from an upload.
app.post("/api/generate", async (req, res) => {
  try {
    const body = req.body || {};
    const copyrightFilter = body.copyrightFilter === "off" ? "off" : "on";
    const referenceMode = body.referenceMode || null;

    let rawInputs = {
      designPhrase: body.designPhrase || "",
      prompt: body.prompt || "",
      niche: body.niche || "",
      shirtAudience: body.shirtAudience || "",
      colorPreference: body.colorPreference || "",
      shirtColorTarget: body.shirtColorTarget || "any",
      mood: body.mood || "",
      graphicElements: body.graphicElements || "",
    };

    const hasAny = rawInputs.designPhrase || rawInputs.prompt || rawInputs.niche || referenceMode === "similar_new_design";
    if (!hasAny) return res.status(400).json({ error: "Add at least a phrase, idea, or niche." });

    const { inputs, hits } = filterInputs(rawInputs, copyrightFilter);

    let brief;
    if (referenceMode === "similar_new_design" && body.uploadedFile) {
      const filePath = path.join(UPLOADS_DIR, path.basename(body.uploadedFile));
      const imgBuf = await fs.readFile(filePath);
      const b64 = (await sharp(imgBuf).resize({ width: 768, height: 768, fit: "inside" }).jpeg({ quality: 80 }).toBuffer()).toString("base64");
      brief = await analyzeReference({ imageBase64: b64, inputs, copyrightFilter });
    } else {
      brief = await generateBrief({ inputs, copyrightFilter });
    }

    const listing = await generateListingMetadata({
      brief,
      inputs,
      direction: body.metadataDirection || "",
      copyrightFilter,
    });
    const { buffer: artwork, source, qa, skipChroma } = await generateArtwork({ brief, copyrightFilter });
    const id = newJobId(brief.mainPhrase || "design");
    const metadata = await finishAndSave({
      jobId: id,
      designBuffer: artwork,
      skipChroma: skipChroma ?? (source !== "openai" && source !== "svg"),
      ctx: {
        mode: referenceMode || "prompt",
        inputMode: referenceMode ? "upload" : "prompt",
        copyrightFilter,
        copyrightHits: hits,
        artworkSource: source,
        designReview: qa,
        brief,
        listing,
      },
    });
    res.json({ ok: true, project: metadata });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || "Generation failed", code: err.code || null });
  }
});

app.post("/api/generation-jobs", async (req, res) => {
  try {
    const body = req.body || {};
    console.log(`[inkly] /api/generation-jobs received — count: ${body.count}, phrase: "${body.designPhrase}", niche: "${body.niche}", copyrightFilter: ${body.copyrightFilter}, aiEnabled: ${Boolean(getOpenAI())}`);
    const copyrightFilter = body.copyrightFilter === "off" ? "off" : "on";
    const referenceMode = body.referenceMode || null;
    const uploadedFile = body.uploadedFile ? path.basename(body.uploadedFile) : null;
    const count = referenceMode === "similar_new_design" ? 1 : Math.max(1, Math.min(Number(body.count) || 1, 30));
    const rawInputs = {
      designPhrase: body.designPhrase || "",
      prompt: body.prompt || "",
      niche: body.niche || "",
      shirtAudience: body.shirtAudience || "",
      colorPreference: body.colorPreference || "",
      shirtColorTarget: body.shirtColorTarget || "any",
      mood: body.mood || "",
      graphicElements: body.graphicElements || "",
    };
    const hasReference = referenceMode === "similar_new_design" && uploadedFile;
    if (!rawInputs.designPhrase && !rawInputs.prompt && !rawInputs.niche && !hasReference) {
      return res.status(400).json({ error: "Add at least a phrase, idea, or niche." });
    }
    const { inputs, hits } = filterInputs(rawInputs, copyrightFilter);
    const job = startGenerationJob({
      rawInputs: inputs,
      count,
      metadataDirection: body.metadataDirection || "",
      copyrightFilter,
      copyrightHits: hits,
      referenceMode,
      uploadedFile,
    });
    res.status(202).json({ ok: true, job: publicJob(job) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Generation job failed to start" });
  }
});

app.get("/api/generation-jobs/:id", (req, res) => {
  const job = generationJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Generation job not found." });
  res.json({ ok: true, job: publicJob(job) });
});

app.get("/api/jobs/:id", async (req, res) => {
  const meta = await readJson(jobPaths(req.params.id).metadata);
  if (!meta) return res.status(404).json({ error: "Job not found" });
  res.json({ project: meta });
});

// Reports which of the given design jobIds still have their PNG on disk.
// Render's ephemeral filesystem is cleared on every deploy/restart (and on
// free-plan idle spin-down), while the browser's saved batch lives in
// localStorage — this is how the client detects that a saved batch now
// points at files that no longer exist, so it can tell the user the batch
// expired instead of showing broken previews and a doomed export.
app.post("/api/designs/verify", (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 3 * 30) : [];
  const missing = [];
  for (const raw of ids) {
    const id = String(raw || "");
    // basename() forbids path traversal; an id that changes under basename
    // was never one of ours — report it missing.
    if (!id || path.basename(id) !== id) {
      missing.push(id);
      continue;
    }
    if (!fsSync.existsSync(path.join(OUTPUTS_DIR, id, "design.png"))) missing.push(id);
  }
  res.json({ ok: true, missing });
});

// Force a file download (rather than inline view).
app.get("/api/download/:id", async (req, res) => {
  const paths = jobPaths(req.params.id);
  const meta = await readJson(paths.metadata);
  if (!meta) return res.status(404).json({ error: "Job not found" });
  const name = `inkly_${safeSlug(meta.brief?.mainPhrase || meta.mode || "design")}_4500x5400.png`;
  res.download(paths.output, name);
});

app.post("/api/export-batch", async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const allowedSources = new Set(["ai_generated", "similar_screenshot", "cleaned_existing", "uploaded_ready_png"]);
    if (!items.length) return res.status(400).json({ error: "Add at least one design before exporting." });
    if (items.length > 30) return res.status(400).json({ error: "A batch can include up to 30 designs." });

    for (const [index, item] of items.entries()) {
      if (!item.jobId) return res.status(400).json({ error: `Design ${index + 1} is missing an image.` });
      if (!allowedSources.has(item.source_type)) return res.status(400).json({ error: `Design ${index + 1} has an invalid source type.` });
      if (!String(item.title || "").trim()) return res.status(400).json({ error: `Design ${index + 1} is missing a title.` });
      if (!Array.isArray(item.keywords) || item.keywords.filter(Boolean).length !== 13) {
        return res.status(400).json({ error: `Design ${index + 1} must have exactly 13 keywords.` });
      }
    }

    // QA export gate. Generation fails open when the REVIEW call errors (the
    // image is already paid for), so export is the enforcement point: designs
    // whose stored review FAILED are hard-blocked; designs that skipped
    // review (QA outage) need an explicit operator confirmation.
    const failedReview = [];
    const unreviewed = [];
    for (const [index, item] of items.entries()) {
      if (item.source_type !== "ai_generated" && item.source_type !== "similar_screenshot") continue;
      const meta = await fs.readFile(jobPaths(path.basename(item.jobId)).metadata, "utf8")
        .then(JSON.parse).catch(() => null);
      const review = meta?.designReview || null;
      if (review?.pass === false) failedReview.push(`Design ${index + 1} (${item.title || item.jobId})`);
      else if (!review || review.status === "skipped") unreviewed.push(`Design ${index + 1} (${item.title || item.jobId})`);
    }
    if (failedReview.length) {
      return res.status(400).json({
        error: `Blocked: ${failedReview.join(", ")} failed the automated design review — regenerate before exporting.`,
      });
    }
    if (unreviewed.length && req.body?.allowUnreviewed !== true) {
      return res.status(409).json({
        error: `${unreviewed.length} design(s) skipped QA review (reviewer was unavailable): ${unreviewed.join(", ")}.`,
        unreviewed,
        confirmable: true,
      });
    }

    const manifestItems = [];
    const entries = [{ name: "designs/", data: Buffer.alloc(0) }];
    for (const [index, item] of items.entries()) {
      const designId = `D${String(index + 1).padStart(3, "0")}`;
      const filename = `${designId}.png`;
      const pngPath = jobPaths(path.basename(item.jobId)).output;
      const data = await fs.readFile(pngPath);
      entries.push({ name: `designs/${filename}`, data });
      manifestItems.push({
        title: String(item.title).trim(),
        keywords: item.keywords.map((k) => String(k).trim()),
        source_type: item.source_type,
      });
    }
    entries.push({ name: "manifest_input.csv", data: Buffer.from(buildManifest(manifestItems), "utf8") });

    const zip = createZip(entries);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="inkly_batch.zip"');
    res.send(zip);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Batch export failed" });
  }
});

// ---- static ----------------------------------------------------------------
app.use("/outputs", express.static(OUTPUTS_DIR));
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  const ai = getOpenAI() ? "AI enabled" : "demo mode (no OPENAI_API_KEY)";
  console.log(`\n  inkly running → http://localhost:${PORT}   [${ai}]\n`);
});
