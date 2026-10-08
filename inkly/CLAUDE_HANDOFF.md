# Inkly Claude Handoff

This document is for a new AI coding agent taking over Inkly with no prior context.

## 1. Project Overview

Inkly is a batch-based Etsy design preparation tool. The user can create, clean up, or upload PNG designs, attach each design to a title and exactly 13 keywords, add selected designs to a batch, and export the final batch as a ZIP file named exactly:

```text
inkly_batch.zip
```

The ZIP should contain:

```text
/designs/D001.png
/designs/D002.png
/designs/D003.png
...
batch_manifest.csv
```

Inkly is only responsible for design creation, cleanup, upload, metadata, batch management, and ZIP export.

Inkly should not handle:

- mockup placement
- store logo stamping
- SKU assignment
- Google Drive upload
- Etsy listing publishing

Those belong to later workflow tools.

Current implementation is a small Node/Express app with a vanilla HTML/CSS/JS frontend. There is no frontend build framework and no bundler.

## 2. Current User Workflow

Intended product workflow:

1. User logs in.
2. User clicks **Start Today's Batch**.
3. User enters the main workspace.
4. User can add designs through:
   - AI Generate Design
   - Generate Similar Design from Screenshot
   - Clean Up Existing Design
   - Upload Ready PNG Design
5. AI/similar-generation jobs run in a background queue.
6. Completed generated designs appear in Generated Results / Review.
7. User previews designs, edits title/keywords if needed, and clicks Add to Batch.
8. Added designs move into Current Batch.
9. User reviews Current Batch.
10. User exports `inkly_batch.zip`.

Current code note: step 1 is not implemented. There is no login/auth route or user session system. The app currently starts at the home screen and uses browser `localStorage` for local state.

## 3. Important Product Rules

Treat these as strict requirements:

- Batch maximum is 30 designs.
- Final ZIP file must always be named exactly `inkly_batch.zip`.
- Exported design files must be sequentially named:
  - `D001.png`
  - `D002.png`
  - `D003.png`
- If designs are removed before export, renumber on export so there are no gaps.
- Export must include `batch_manifest.csv`.
- Manifest columns must be exactly:

```csv
design_id,filename,title,keyword_1,keyword_2,keyword_3,keyword_4,keyword_5,keyword_6,keyword_7,keyword_8,keyword_9,keyword_10,keyword_11,keyword_12,keyword_13,source_type
```

- Every batch design must have:
  - image
  - title
  - exactly 13 keywords
  - source_type
- Allowed `source_type` values:
  - `ai_generated`
  - `similar_screenshot`
  - `cleaned_existing`
  - `uploaded_ready_png`
- Do not change current Inkly image sizing/resolution behavior unless explicitly asked.

Current image behavior:

- AI-generated and cleaned designs go through the backend finish pipeline, which composes transparent PNGs on the configured canvas, currently defaulting to 4500 x 5400 at 300 DPI.
- Upload Ready PNG saves the uploaded PNG as-is in `storage/outputs/<jobId>/design.png`.
- Export copies each stored output file into the ZIP and renumbers filenames sequentially at export time.

## 4. Copyright Filter Behavior

Inkly has a Copyright Filter toggle.

If Copyright Filter is OFF:

- do not warn
- do not block
- do not rewrite
- do not modify prompts, titles, keywords, or design instructions based on copyright/trademark/IP concerns
- generate exactly according to the user's request
- do not display internal warnings to Inkly or the user

If Copyright Filter is ON:

- Inkly may warn, rewrite, suggest safer alternatives, or block depending on implemented logic.

This behavior is intentional and should not be changed.

Implemented behavior:

- `lib/copyrightFilter.js` returns inputs unchanged when `copyrightFilter !== "on"`.
- `lib/designRules.js` includes explicit prompt language for ON and OFF modes.
- `lib/openaiClient.js` planning prompt says OFF means do not warn, block, rewrite, remove, or modify prompt/title/keyword/design instructions for IP reasons.

Important nuance: turning the filter OFF disables Inkly's checks only. It does not grant rights to protected material or override marketplace policies.

## 5. Implemented Features So Far

Implemented:

- `server.js`: Express app, API routes, in-memory generation job map, serial background generation queue, batch export, static file serving.
- `public/index.html`: single-page UI structure. Screens include home, workspace, generated review, current batch, legacy similar-selection screen, processing screen, preview modal, metadata modal, and generation toast.
- `public/app.js`: all frontend state and UI behavior. It manages navigation, batch state, generated results, local persistence, metadata editing, preview modal, generation polling, queue aggregation, ready PNG inline add flow, and export download.
- `public/styles.css`: current dark Inkly theme, layout, cards, modals, toast, responsive rules, and design preview containment rules.
- `lib/fileStore.js`: storage paths, job ID creation, safe slugging, JSON read/write helpers.
- `lib/openaiClient.js`: OpenAI text/image integration plus deterministic SVG fallback/demo mode. Handles brief generation, trend planning, reference analysis, listing metadata, and image generation.
- `lib/designRules.js`: style guide, prompt builders, reference prompt, image prompt, heuristic brief.
- `lib/copyrightFilter.js`: starter protected-term list and input filtering when the filter is ON.
- `lib/backgroundRemover.js`: sharp-based chroma/edge cleanup plus optional Photoroom/remove.bg provider calls.
- `lib/upscaler.js`: sharp Lanczos upscaling plus optional Replicate Real-ESRGAN provider.
- `lib/exportPng.js`: trims/centers/composes transparent PNG on the configured export canvas.
- `lib/qualityEvaluator.js`: simple output quality scoring.
- `lib/svgRender.js`: deterministic SVG-to-PNG fallback designs for demo/no-key mode.
- `lib/zipBuilder.js`: no-dependency ZIP file creation with CRC32.

Frontend state:

- `state.batch`: current batch items that will export.
- `state.generatedResults`: generated AI/similar results waiting in Review.
- `state.generationJobs`: frontend snapshots of backend generation jobs.
- `state.dismissedToasts`: tracks dismissed active/completed toast states.
- `state.readyUpload`: temporary Upload Ready PNG data before Add to Batch.
- `state.pendingMetadata` and `state.editingId`: metadata modal state.
- `state.previewContext`: preview modal target.
- `state.similarCandidates`: legacy state from the old 3-option similar flow.

State persistence:

- `public/app.js` saves `started`, `copyrightFilter`, `batch`, `generatedResults`, `generationJobs`, and `dismissedToasts` to `localStorage` key `inklyBatchState`.
- Backend generation jobs are only in memory. If the server restarts, saved frontend job IDs cannot be polled successfully.

Batch/cart structure:

- Batch items are frontend objects with `localId`, `jobId`, `imageUrl`, `title`, `keywords`, `source_type`, and `status`.
- `addItem()` in `public/app.js` enforces the 30-item batch limit before pushing to `state.batch`.
- Current Batch cards support Preview, Edit, and Remove.

Generated results/review structure:

- Completed job results are imported by `importJobResults()` in `public/app.js`.
- AI results get `source_type: "ai_generated"`.
- Similar screenshot results get `source_type: "similar_screenshot"` when backend `project.mode === "similar_new_design"`.
- Generated Results cards support Preview Design, Add to Batch, and Discard.

Background queue implementation:

- `server.js` keeps `generationJobs` in a `Map`.
- `startGenerationJob()` creates one job per request and chains work onto `generationQueue = generationQueue.then(...)`, making jobs run serially.
- `POST /api/generation-jobs` starts queued background jobs and returns HTTP 202.
- `GET /api/generation-jobs/:id` returns job status.
- Frontend `activeQueueSummary()` aggregates multiple active jobs into one visible progress total, so new AI/similar jobs append to the displayed queue total instead of resetting it.

Export implementation:

- `POST /api/export-batch` in `server.js` validates item count, source type, title, and 13 keywords.
- It renumbers export files sequentially as `D001.png`, `D002.png`, etc.
- It writes entries under `designs/` and adds `batch_manifest.csv`.
- It sends `Content-Disposition: attachment; filename="inkly_batch.zip"`.
- Frontend export handler also forces download name `inkly_batch.zip`.

Upload Ready PNG flow:

- `POST /api/upload-ready-png` accepts only PNG files, stores the uploaded PNG as the job output, records alpha/size metadata, and returns `project.output_url`.
- `renderReadyTool()`, `runReadyUpload()`, `renderReadyDetail()`, `updateReadyValidation()`, and `addReadyUploadToBatch()` in `public/app.js` implement an inline preview/title/13-keyword flow.
- The inline flow adds directly to Current Batch as `source_type: "uploaded_ready_png"` and no longer uses the shared Save Metadata modal.

Similar screenshot flow:

- `renderSimilarTool()` uploads a screenshot via `/api/upload`.
- `runSimilarUpload()` posts to `/api/generation-jobs` with `referenceMode: "similar_new_design"` and `count: 1`.
- Backend forces similar jobs to count 1.
- Completed similar output appears in Generated Results / Review with generated title and keywords.
- Legacy 3-option similar code still exists (`screen-similar`, `renderSimilarOptions()`, `state.similarCandidates`) but the current main flow does not use it.

Cleanup existing design flow:

- `renderCleanupTool()` uploads an existing image.
- `runCleanupUpload()` posts to `/api/process-cleanup`.
- Backend uses Photoroom first if configured, then remove.bg if configured; without either provider, cleanup may fail with `MISSING_BACKGROUND_PROVIDER`.
- Successful cleanup opens the shared metadata modal, then adds to batch as `source_type: "cleaned_existing"`.

AI generation flow:

- `renderAiTool()` shows prompt/niche/count/metadata direction/shirt color fields.
- `runAiGenerate()` posts to `/api/generation-jobs`, appends the job into frontend `state.generationJobs`, starts polling, and lets the user add another generation while the queue runs.
- Backend uses OpenAI when `OPENAI_API_KEY` is set, or deterministic SVG fallback when not.

Metadata editor/modals:

- `metadataModal` in `public/index.html` is used for editing Current Batch items and for cleanup/manual legacy pending metadata.
- `previewModal` in `public/index.html` is used for full design preview, metadata edit, Add to Batch, and Discard/Remove.
- Generated results can be edited in the preview modal before Add to Batch.

Preview modal/lightbox:

- `openPreviewModal()`, `savePreviewMetadata()`, `addPreviewToBatch()`, and `discardPreviewItem()` in `public/app.js` manage Preview Design behavior.
- The modal shows a full PNG preview with title and keyword editor.

Notification/toast behavior:

- `jobToast` in `public/index.html` shows active/completed/failed generation status.
- `renderJobToast()` aggregates active jobs and displays merged progress.
- X close button calls `dismissJobToast()`.
- Dismissing the toast only hides the notification. It does not cancel generation and does not delete generated results.
- Adding a new job changes the aggregate dismiss key, so a previously dismissed toast can reappear for new work.

API routes/server handlers:

- `GET /api/status`: AI/provider/canvas status.
- `POST /api/upload`: upload PNG/JPG/JPEG/WEBP and return basic analysis.
- `POST /api/process-cleanup`: process uploaded image through background removal/upscale/export pipeline.
- `POST /api/upload-ready-png`: upload a finished PNG as a ready design.
- `POST /api/generate`: legacy synchronous generate endpoint.
- `POST /api/generation-jobs`: current background AI/similar generation endpoint.
- `GET /api/generation-jobs/:id`: poll generation job status.
- `GET /api/jobs/:id`: read stored job metadata.
- `GET /api/download/:id`: download an individual output PNG.
- `POST /api/export-batch`: validate batch and return `inkly_batch.zip`.
- `GET /outputs/...`: static output file serving.
- `GET *`: serves `public/index.html`.

## 6. Known Bugs / Current Issues

Recently reported issues and current status:

1. Upload Ready PNG metadata flow
   - Reported: Save Metadata button was not working.
   - Desired: direct Add to Batch after upload/title/exactly 13 keywords.
   - Current status: appears implemented in `public/app.js`. The ready PNG flow now renders an inline editor and Add to Batch button. The shared Save Metadata modal still exists for other flows.

2. Queue appending
   - Reported: new AI generation requests should append to current queue progress.
   - Current status: appears implemented as frontend aggregate progress over multiple backend jobs. Backend still stores separate jobs, but frontend displays merged active/completed totals.
   - Caveat: backend job state is in memory only and disappears on server restart.

3. Similar Screenshot generation
   - Reported: should generate only 1 design, use shared queue, append to active queue, auto-generate title/13 keywords, and appear in Review.
   - Current status: appears implemented through `/api/generation-jobs` with `referenceMode: "similar_new_design"` and backend-forced count 1.
   - Remaining issue: `public/index.html` card copy still says "preview 3 options", and legacy 3-option code/screen remains.

4. Design card preview images
   - Reported: images were cropped/cut off.
   - Current status: `public/styles.css` now uses fixed preview containers and `object-fit: contain` for Generated Results, Current Batch, Similar option cards, metadata/cleaned previews, and ready PNG previews.
   - Needs manual QA with varied real design dimensions.

5. Generation toast
   - Reported: should have X close; closing should not cancel background generation or delete results.
   - Current status: implemented. X only records dismissal and hides the toast.

Other issues found by inspection:

- No login/auth is implemented despite the intended workflow saying "User logs in."
- The README API section is stale. It does not mention `/api/generation-jobs`, `/api/upload-ready-png`, or `/api/export-batch`.
- The home/workspace UI is current, but some Similar Screenshot copy and legacy state still describe the old 3-option flow.
- `parseKeywords()` truncates to 13 keywords with `.slice(0, 13)`. If a user enters more than 13, the UI may silently accept the first 13 rather than reporting too many. The strict product language says exactly 13 keywords, so this should be reviewed.
- Generation requests are capped by current batch remaining slots at request time, but in-flight/generated review items are not counted against future generation requests. A user can over-generate more than 30 review results if they queue more while the batch is still empty. Add-to-batch still enforces 30.
- Server-side generation jobs and stored job progress are not persistent. Refresh survives through `localStorage`, but server restart breaks polling for active saved jobs.
- There is no automated test suite or lint script.
- There is no storage cleanup/retention policy for `storage/uploads` or `storage/outputs`.
- `POST /api/generate` is a legacy synchronous endpoint that may be unused by the current UI.
- `.env` exists locally. Do not expose or commit real values.

## 7. Pending Work / Next Recommended Tasks

Priority 1 - Verify and harden Upload Ready PNG flow

- Confirm real browser file upload works end to end.
- Confirm metadata validation rejects missing title and keyword counts other than exactly 13.
- Decide whether more than 13 entered keywords should be rejected instead of silently truncated.
- Confirm Add to Batch updates basket count and resets the form.
- Confirm exported `source_type` is `uploaded_ready_png`.

Priority 2 - Verify and harden queue appending

- Test AI + AI, AI + Similar, and Similar + AI while jobs are active.
- Confirm displayed progress examples:
  - 0 of 3 plus 1 becomes 0 of 4.
  - 2 of 5 plus 3 becomes 2 of 8.
- Confirm completed count does not reset.
- Consider whether generated review results or active queued totals should count against the 30-design cap.
- Consider persistence strategy if server restarts matter.

Priority 3 - Clean up Similar Screenshot flow

- Update stale UI copy from "preview 3 options" to the current 1-result review flow.
- Remove or quarantine legacy `screen-similar`, `state.similarCandidates`, and `renderSimilarOptions()` if no longer needed.
- Verify title and exactly 13 keywords are generated for similar screenshot results.
- Verify results appear in Generated Results / Review, not Current Batch.
- Verify Preview Design, Edit Metadata, Add to Batch, and Discard all work.

Priority 4 - Verify image fitting in cards

- Manual QA with tall, wide, square, transparent, and non-transparent images.
- Confirm full image is visible in:
  - Generated Results
  - Current Batch
  - Upload Ready PNG preview
  - Similar Screenshot results
  - Cleaned Existing metadata preview
- Keep fixed preview containers, `object-fit: contain`, `object-position: center`, and `overflow: hidden`.
- Do not use `object-fit: cover` for design PNG previews.

Priority 5 - Verify export

- Confirm browser download is named `inkly_batch.zip`.
- Confirm ZIP contains `designs/`.
- Confirm ZIP contains `designs/D001.png`, `designs/D002.png`, etc.
- Confirm ZIP contains `batch_manifest.csv`.
- Confirm CSV headers are exact.
- Confirm CSV title and keyword escaping works for commas, quotes, and newlines.
- Confirm removing a design before export renumbers with no gaps.
- Confirm server rejects invalid source types, missing image/title, and non-13 keyword arrays.

## 8. Technical Architecture

Framework/runtime:

- Node.js ESM project, Node >= 20.
- Express backend in `server.js`.
- Vanilla frontend in `public/index.html`, `public/styles.css`, and `public/app.js`.
- No frontend build step.

Major dependencies:

- `express`: server and API routing.
- `multer`: multipart upload handling.
- `sharp`: image processing, metadata, resizing, compositing, SVG rendering.
- `openai`: text/image/reference generation.
- `dotenv`: environment variables.
- `nodemon`: dev server reload.

Image processing:

- `lib/backgroundRemover.js`: chroma/edge removal and provider-backed removal.
- `lib/upscaler.js`: sharp Lanczos plus optional Replicate Real-ESRGAN.
- `lib/exportPng.js`: final transparent canvas composition.
- `lib/qualityEvaluator.js`: output quality metadata.
- `lib/svgRender.js`: demo/fallback artwork.

ZIP/CSV:

- `server.js` builds CSV manifest with `buildManifest()` and `csvCell()`.
- `lib/zipBuilder.js` creates the ZIP directly. There is no JSZip dependency.

AI/image integrations:

- OpenAI text model via `OPENAI_TEXT_MODEL`, default `gpt-4o`.
- OpenAI image model via `OPENAI_IMAGE_MODEL`, default `gpt-image-1`.
- OpenAI image size via `OPENAI_IMAGE_SIZE`, default `1024x1536`.
- `USE_PLACEHOLDER_IMAGES=true` forces SVG fallback.

Background removal/upscaling integrations:

- Photoroom: `PHOTOROOM_API_KEY`.
- remove.bg: `REMOVEBG_API_KEY`.
- Replicate upscaling: `UPSCALE_PROVIDER=replicate`, `REPLICATE_API_TOKEN`, `UPSCALE_MODEL`.

Environment variables:

- `PORT`
- `OPENAI_API_KEY`
- `OPENAI_TEXT_MODEL`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_IMAGE_SIZE`
- `OPENAI_IMAGE_QUALITY`
- `USE_PLACEHOLDER_IMAGES`
- `DESIGN_CHROMA_COLOR`
- `DESIGN_CHROMA_THRESHOLD`
- `DESIGN_CHROMA_FEATHER`
- `DESIGN_EDGE_BG_THRESHOLD`
- `DESIGN_CLEANUP_MAX_SIZE`
- `DEFAULT_CANVAS_WIDTH`
- `DEFAULT_CANVAS_HEIGHT`
- `EXPORT_DPI`
- `UPSCALE_PROVIDER`
- `REPLICATE_API_TOKEN`
- `UPSCALE_MODEL`
- `UPSCALE_TARGET_LONG_EDGE`
- `MAX_REGEN_ATTEMPTS`
- `PHOTOROOM_API_KEY` and `REMOVEBG_API_KEY` are used by code, though not both are shown in `.env.example`.

Do not expose actual key values from `.env`.

## 9. Setup and Run Instructions

Install:

```bash
npm install
```

Create environment file:

```bash
cp .env.example .env
```

Run:

```bash
npm start
```

Dev run with auto-reload:

```bash
npm run dev
```

Default URL:

```text
http://localhost:5500
```

Build command:

- None. This project has no build script.

Test/lint commands:

- None configured in `package.json`.
- Current lightweight syntax checks used during handoff:

```bash
node --check server.js
node --check public/app.js
```

Both passed on 2026-06-28.

## 10. Testing Checklist for Claude

- Start app successfully.
- Start Today's Batch works.
- Copyright Filter ON/OFF toggle persists and affects requests correctly.
- AI generation request creates a queue job.
- New generation request appends to the active queue.
- Similar Screenshot request appends to the active queue.
- Queue toast progress updates correctly.
- Toast X hides toast without canceling jobs.
- Closing completed toast does not delete generated results.
- Generated results appear in Review.
- Preview Design opens full PNG modal.
- Preview modal metadata edits save.
- Add to Batch works from generated result cards.
- Add to Batch works from preview modal.
- Discard works from generated result cards.
- Current Batch Preview/Edit/Remove works.
- Uploaded Ready PNG Add to Batch works.
- Similar Screenshot creates one queued result.
- Similar Screenshot generated result has title and 13 keywords.
- Clean Up Existing Design works when background-removal provider keys are configured.
- Cards show full images without cropping.
- Current Batch shows correct count.
- Batch max 30 is enforced.
- Export creates `inkly_batch.zip`.
- ZIP contains `designs/`.
- ZIP contains sequential `D001.png`, `D002.png`, etc.
- ZIP contains `batch_manifest.csv`.
- CSV has exact header.
- CSV has correct title and 13 keyword columns.
- CSV escaping works for commas, quotes, and newlines.
- Server restart behavior for active jobs is understood or improved.

## 11. Design/UI Notes

Preserve:

- current Inkly theme
- current dark UI
- current spacing and component style
- current animation feel
- current overall layout language

Do not redesign from scratch. Prefer focused fixes that follow the existing visual language.

## 12. Git / Commit State

Verified with actual Git commands on 2026-06-28:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
```

All returned:

```text
fatal: not a git repository (or any of the parent directories): .git
```

Current branch name:

- Not available. This project folder is not currently a Git repository.

Latest commit hash:

- Not available.

Working tree clean/dirty:

- Cannot be determined with Git because `.git` metadata is absent.

Files currently modified/uncommitted:

- Cannot be determined with Git because `.git` metadata is absent.
- Current source files of interest are `server.js`, `public/app.js`, `public/styles.css`, `public/index.html`, and files under `lib/`.

Build/test status:

- No build script exists.
- No test/lint script exists.
- `node --check server.js` passed.
- `node --check public/app.js` passed.

