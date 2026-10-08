const MAX_BATCH = 30;
const SOURCES = {
  ai_generated: "AI generated",
  similar_screenshot: "Similar screenshot",
  cleaned_existing: "Cleaned existing",
  uploaded_ready_png: "Uploaded ready PNG",
};

const state = {
  started: false,
  copyrightFilter: "on",
  batch: [],
  generatedResults: [],
  generationJobs: [],
  dismissedToasts: {},
  readyReview: null,
  activeTool: null,
  pendingMetadata: null,
  editingId: null,
  previewContext: null,
};

const els = {
  backBtn: document.getElementById("backBtn"),
  brandHome: document.getElementById("brandHome"),
  startBatchBtn: document.getElementById("startBatchBtn"),
  resumeBatchBtn: document.getElementById("resumeBatchBtn"),
  reviewNavBtn: document.getElementById("reviewNavBtn"),
  cartBtn: document.getElementById("cartBtn"),
  reviewCount: document.getElementById("reviewCount"),
  cartCount: document.getElementById("cartCount"),
  workspaceStatus: document.getElementById("workspaceStatus"),
  batchProgress: document.getElementById("batchProgress"),
  batchStatus: document.getElementById("batchStatus"),
  batchGrid: document.getElementById("batchGrid"),
  reviewTitle: document.getElementById("reviewTitle"),
  reviewGrid: document.getElementById("reviewGrid"),
  exportBatchBtn: document.getElementById("exportBatchBtn"),
  openReviewBtn: document.getElementById("openReviewBtn"),
  openBatchBtn: document.getElementById("openBatchBtn"),
  reviewBackWorkspaceBtn: document.getElementById("reviewBackWorkspaceBtn"),
  reviewOpenBatchBtn: document.getElementById("reviewOpenBatchBtn"),
  batchBackWorkspaceBtn: document.getElementById("batchBackWorkspaceBtn"),
  toolPanel: document.getElementById("toolPanel"),
  copyrightToggle: document.getElementById("copyrightToggle"),
  statusPill: document.getElementById("statusPill"),
  jobToast: document.getElementById("jobToast"),
  jobToastTitle: document.getElementById("jobToastTitle"),
  jobToastCount: document.getElementById("jobToastCount"),
  jobToastBar: document.getElementById("jobToastBar"),
  jobToastSub: document.getElementById("jobToastSub"),
  jobToastAction: document.getElementById("jobToastAction"),
  jobToastClose: document.getElementById("jobToastClose"),
  previewModal: document.getElementById("previewModal"),
  previewEyebrow: document.getElementById("previewEyebrow"),
  previewHeading: document.getElementById("previewHeading"),
  previewFullImg: document.getElementById("previewFullImg"),
  previewSourceType: document.getElementById("previewSourceType"),
  previewKeywordStatus: document.getElementById("previewKeywordStatus"),
  previewTitleInput: document.getElementById("previewTitleInput"),
  previewKeywordsInput: document.getElementById("previewKeywordsInput"),
  previewHelp: document.getElementById("previewHelp"),
  previewSaveBtn: document.getElementById("previewSaveBtn"),
  previewAddBtn: document.getElementById("previewAddBtn"),
  previewDiscardBtn: document.getElementById("previewDiscardBtn"),
  previewCloseBtn: document.getElementById("previewCloseBtn"),
  closePreviewBtn: document.getElementById("closePreviewBtn"),
  metadataModal: document.getElementById("metadataModal"),
  metadataPreview: document.getElementById("metadataPreview"),
  metadataEyebrow: document.getElementById("metadataEyebrow"),
  metadataTitle: document.getElementById("metadataTitle"),
  metaTitleInput: document.getElementById("metaTitleInput"),
  metaKeywordsInput: document.getElementById("metaKeywordsInput"),
  metadataHelp: document.getElementById("metadataHelp"),
  closeMetadataBtn: document.getElementById("closeMetadataBtn"),
  saveMetadataBtn: document.getElementById("saveMetadataBtn"),
  cancelMetadataBtn: document.getElementById("cancelMetadataBtn"),
  procTitle: document.getElementById("procTitle"),
  procSub: document.getElementById("procSub"),
  readyReviewModal: document.getElementById("readyReviewModal"),
  readyReviewHeading: document.getElementById("readyReviewHeading"),
  readyReviewImg: document.getElementById("readyReviewImg"),
  readyReviewNote: document.getElementById("readyReviewNote"),
  readyReviewKeywordStatus: document.getElementById("readyReviewKeywordStatus"),
  readyReviewTitleInput: document.getElementById("readyReviewTitleInput"),
  readyReviewKeywordsInput: document.getElementById("readyReviewKeywordsInput"),
  readyReviewHelp: document.getElementById("readyReviewHelp"),
  readyReviewProgress: document.getElementById("readyReviewProgress"),
  readyReviewAddAllBtn: document.getElementById("readyReviewAddAllBtn"),
  readyReviewCancelBtn: document.getElementById("readyReviewCancelBtn"),
  closeReadyReviewBtn: document.getElementById("closeReadyReviewBtn"),
  readyPrevBtn: document.getElementById("readyPrevBtn"),
  readyNextBtn: document.getElementById("readyNextBtn"),
};

const navStack = ["home"];
let pollTimer = null;

function go(view) {
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
  document.getElementById(`screen-${view}`).classList.add("active");
  if (navStack[navStack.length - 1] !== view) navStack.push(view);
  els.backBtn.classList.toggle("show", view !== "home" && view !== "processing");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goBack() {
  if (navStack.length > 1) {
    navStack.pop();
    const view = navStack[navStack.length - 1];
    document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
    document.getElementById(`screen-${view}`).classList.add("active");
    els.backBtn.classList.toggle("show", view !== "home" && view !== "processing");
    return;
  }
  go(state.started ? "workspace" : "home");
}

els.backBtn.onclick = goBack;
els.brandHome.onclick = () => go(state.started ? "workspace" : "home");
els.reviewNavBtn.onclick = () => go("review");
els.cartBtn.onclick = () => go("batch");
els.openReviewBtn.onclick = () => go("review");
els.openBatchBtn.onclick = () => go("batch");
els.reviewBackWorkspaceBtn.onclick = () => go("workspace");
els.reviewOpenBatchBtn.onclick = () => go("batch");
els.batchBackWorkspaceBtn.onclick = () => go("workspace");
els.jobToastAction.onclick = () => go("review");
els.jobToastClose.onclick = dismissJobToast;

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function remainingSlots() {
  return Math.max(0, MAX_BATCH - state.batch.length);
}

function parseKeywords(text) {
  return String(text || "")
    .split(/\n|,/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function itemReadiness(item) {
  if (item.status === "processing") return "Processing";
  if (item.status === "failed") return "Failed";
  if (!String(item.title || "").trim()) return "Missing Title";
  if (!Array.isArray(item.keywords) || item.keywords.length !== 13) return "Missing Keywords";
  return "Ready";
}

function isMetadataValid(item) {
  return Boolean(String(item?.title || "").trim()) && Array.isArray(item?.keywords) && item.keywords.length === 13;
}

function validItems() {
  return state.batch.filter((item) => itemReadiness(item) === "Ready");
}

function saveState() {
  localStorage.setItem("inklyBatchState", JSON.stringify({
    started: state.started,
    copyrightFilter: state.copyrightFilter,
    batch: state.batch,
    generatedResults: state.generatedResults,
    generationJobs: state.generationJobs,
    dismissedToasts: state.dismissedToasts,
  }));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem("inklyBatchState") || "null");
    if (!saved) return;
    state.started = Boolean(saved.started);
    state.copyrightFilter = saved.copyrightFilter === "off" ? "off" : "on";
    state.batch = Array.isArray(saved.batch) ? saved.batch.slice(0, MAX_BATCH) : [];
    state.generatedResults = Array.isArray(saved.generatedResults) ? saved.generatedResults : [];
    state.generationJobs = Array.isArray(saved.generationJobs) ? saved.generationJobs : [];
    state.dismissedToasts = saved.dismissedToasts && typeof saved.dismissedToasts === "object" ? saved.dismissedToasts : {};
    if (state.batch.length || state.generatedResults.length) els.resumeBatchBtn.hidden = false;
  } catch {
    localStorage.removeItem("inklyBatchState");
  }
}

function startBatch({ resume = false } = {}) {
  if (!resume) {
    state.batch = [];
    state.generatedResults = [];
    state.generationJobs = [];
  }
  state.started = true;
  state.activeTool = null;
  els.toolPanel.hidden = true;
  renderAll();
  saveState();
  startPolling();
  go("workspace");
}

els.startBatchBtn.onclick = () => startBatch();
els.resumeBatchBtn.onclick = () => startBatch({ resume: true });

function setCopyright(value) {
  state.copyrightFilter = value === "off" ? "off" : "on";
  renderCopyrightToggle();
  saveState();
}

function renderCopyrightToggle() {
  els.copyrightToggle.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.cf === state.copyrightFilter);
  });
}

els.copyrightToggle.onclick = (event) => {
  const btn = event.target.closest("button[data-cf]");
  if (btn) setCopyright(btn.dataset.cf);
};

function renderAll() {
  renderCopyrightToggle();
  renderTopNav();
  renderWorkspaceStatus();
  renderReview();
  renderBatch();
  renderJobToast();
}

function activeJobs() {
  return state.generationJobs.filter((job) => job.status === "queued" || job.status === "generating");
}

function activeQueueSummary() {
  if (!activeJobs().length) return null;
  const jobs = state.generationJobs;
  return summarizeJobs("active", jobs, "generating");
}

function completedQueueSummary() {
  if (!state.generationJobs.length || activeJobs().length) return null;
  const done = state.generationJobs.filter((job) => job.status === "completed" || job.status === "failed");
  if (!done.length) return null;
  const status = done.some((job) => job.completed > 0) ? "completed" : "failed";
  return summarizeJobs("done", done, status);
}

function summarizeJobs(prefix, jobs, status) {
  const ids = jobs.map((job) => job.id).join("|");
  return {
    id: `${prefix}:${ids}`,
    status,
    total: jobs.reduce((sum, job) => sum + (Number(job.total) || 0), 0),
    completed: jobs.reduce((sum, job) => sum + (Number(job.completed) || 0), 0),
    failed: jobs.reduce((sum, job) => sum + (Number(job.failed) || 0), 0),
    errors: jobs.flatMap((job) => job.errors || []),
  };
}

function renderTopNav() {
  els.cartCount.textContent = `${state.batch.length} / ${MAX_BATCH}`;
  els.reviewCount.textContent = String(state.generatedResults.length);
  els.reviewNavBtn.classList.toggle("has-items", state.generatedResults.length > 0);
  els.cartBtn.classList.toggle("has-items", state.batch.length > 0);
}

function renderWorkspaceStatus() {
  const running = activeQueueSummary();
  if (running) {
    els.workspaceStatus.textContent = `Generation is running in the background: ${running.completed} of ${running.total} complete.`;
  } else if (state.generatedResults.length) {
    els.workspaceStatus.textContent = `${state.generatedResults.length} generated design${state.generatedResults.length === 1 ? "" : "s"} ready to review.`;
  } else {
    els.workspaceStatus.textContent = "Generated AI work stays in review until you add it to the batch.";
  }
}

function renderBatch() {
  const count = state.batch.length;
  const ready = validItems().length;
  const invalid = count - ready;
  els.batchProgress.textContent = `${count} / ${MAX_BATCH} Designs Added`;
  els.batchStatus.textContent = count
    ? `${ready} ready${invalid ? ` · ${invalid} need metadata` : ""}`
    : "No designs have been added to the current batch.";
  els.exportBatchBtn.disabled = !count || invalid > 0;

  if (!count) {
    els.batchGrid.innerHTML = `<div class="empty-state">No designs in this batch yet.</div>`;
    return;
  }

  els.batchGrid.innerHTML = state.batch.map((item, index) => batchCardMarkup(item, index)).join("");
}

function batchCardMarkup(item, index) {
  const readyState = itemReadiness(item);
  const designId = `D${String(index + 1).padStart(3, "0")}`;
  const keywordCount = Array.isArray(item.keywords) ? item.keywords.length : 0;
  return `<article class="batch-card">
    <div class="batch-thumb checker"><img src="${item.imageUrl}" alt="${designId} preview" loading="lazy"></div>
    <div class="batch-meta">
      <div class="row">
        <span class="design-id">${designId}</span>
        <span class="status ${readyState.toLowerCase().replace(/\s+/g, "-")}">${readyState}</span>
      </div>
      <h3>${escapeHtml(item.title || "Untitled design")}</h3>
      <p>${SOURCES[item.source_type] || item.source_type}</p>
      <div class="mini-lines">
        <span>${item.title ? "Title added" : "Missing title"}</span>
        <span>${keywordCount} / 13 keywords</span>
      </div>
      ${item.note ? `<div class="note-line">${escapeHtml(item.note)}</div>` : ""}
      <div class="card-actions">
        <button class="btn subtle small" data-preview-batch="${item.localId}">Preview Design</button>
        <button class="btn subtle small" data-edit="${item.localId}">Edit metadata</button>
        <button class="btn ghost small" data-remove="${item.localId}">Remove</button>
      </div>
    </div>
  </article>`;
}

function renderReview() {
  const count = state.generatedResults.length;
  els.reviewTitle.textContent = `${count} design${count === 1 ? "" : "s"} ready to review`;
  if (!count) {
    els.reviewGrid.innerHTML = `<div class="empty-state">No generated results waiting. Start an AI generation job from the main workspace.</div>`;
    return;
  }
  els.reviewGrid.innerHTML = state.generatedResults.map((item) => {
    const keywordCount = Array.isArray(item.keywords) ? item.keywords.length : 0;
    return `<article class="result-card" data-result-card="${item.localId}">
      <div class="result-thumb checker"><img src="${item.imageUrl}" alt="generated result preview" loading="lazy"></div>
      <div class="result-meta">
        <div class="row">
          <span class="design-id">AI RESULT</span>
          <span class="status ready">${keywordCount} / 13 keywords</span>
        </div>
        <h3>${escapeHtml(item.title || "Untitled generated design")}</h3>
        <div class="keyword-list">${(item.keywords || []).map((keyword) => `<span>${escapeHtml(keyword)}</span>`).join("")}</div>
        <div class="card-actions">
          <button class="btn subtle small" data-preview-result="${item.localId}">Preview Design</button>
          <button class="btn small" data-add-result="${item.localId}">Add to Batch</button>
          <button class="btn ghost small" data-discard-result="${item.localId}">Discard</button>
        </div>
      </div>
    </article>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[ch]));
}

els.batchGrid.onclick = (event) => {
  const preview = event.target.closest("[data-preview-batch]");
  const edit = event.target.closest("[data-edit]");
  const remove = event.target.closest("[data-remove]");
  if (preview) {
    const item = state.batch.find((x) => x.localId === preview.dataset.previewBatch);
    if (item) openPreviewModal({ kind: "batch", localId: item.localId });
  }
  if (edit) {
    const item = state.batch.find((x) => x.localId === edit.dataset.edit);
    if (item) openMetadata({ item, editing: true });
  }
  if (remove) {
    state.batch = state.batch.filter((x) => x.localId !== remove.dataset.remove);
    renderAll();
    saveState();
  }
};

els.reviewGrid.onclick = async (event) => {
  const preview = event.target.closest("[data-preview-result]");
  const add = event.target.closest("[data-add-result]");
  const discard = event.target.closest("[data-discard-result]");
  if (preview) openPreviewModal({ kind: "result", localId: preview.dataset.previewResult });
  if (add) addGeneratedResult(add.dataset.addResult, event.target.closest("[data-result-card]"));
  if (discard) {
    state.generatedResults = state.generatedResults.filter((item) => item.localId !== discard.dataset.discardResult);
    renderAll();
    saveState();
  }
};

function addGeneratedResult(localId, card) {
  if (!remainingSlots()) {
    showToastMessage("Batch is full. Remove a design or export before adding more.");
    return;
  }
  const item = state.generatedResults.find((result) => result.localId === localId);
  if (!item) return;
  if (!isMetadataValid(item)) {
    openPreviewModal({ kind: "result", localId });
    return;
  }
  animateToCart(card);
  addItem({ ...item });
  state.generatedResults = state.generatedResults.filter((result) => result.localId !== localId);
  renderAll();
  saveState();
}

function animateToCart(card) {
  if (!card) return;
  const start = card.getBoundingClientRect();
  const end = els.cartBtn.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add("fly-card");
  ghost.style.left = `${start.left}px`;
  ghost.style.top = `${start.top}px`;
  ghost.style.width = `${start.width}px`;
  ghost.style.height = `${start.height}px`;
  document.body.appendChild(ghost);
  requestAnimationFrame(() => {
    ghost.style.transform = `translate(${end.left - start.left}px, ${end.top - start.top}px) scale(.12)`;
    ghost.style.opacity = "0";
  });
  setTimeout(() => ghost.remove(), 650);
}

document.querySelectorAll("[data-add]").forEach((btn) => {
  btn.onclick = () => {
    if (!remainingSlots()) {
      showToolMessage("The batch is full. Remove a design before adding another.", "warn");
      return;
    }
    state.activeTool = btn.dataset.add;
    renderTool(btn.dataset.add);
  };
});

function renderTool(tool) {
  els.toolPanel.hidden = false;
  if (tool === "ai") renderAiTool();
  if (tool === "similar") renderSimilarTool();
  if (tool === "cleanup") renderCleanupTool();
  if (tool === "ready") renderReadyTool();
  els.toolPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showToolMessage(message, type = "info") {
  els.toolPanel.hidden = false;
  els.toolPanel.innerHTML = `<div class="notice ${type === "info" ? "info" : ""}">${escapeHtml(message)}</div>`;
}

function showToastMessage(message) {
  els.jobToast.hidden = false;
  els.jobToastTitle.textContent = message;
  els.jobToastCount.textContent = "";
  els.jobToastSub.textContent = "";
  els.jobToastBar.style.width = "100%";
  els.jobToastAction.hidden = true;
  setTimeout(renderJobToast, 2600);
}

function renderAiTool() {
  els.toolPanel.innerHTML = `<h2>AI Generate Design</h2>
    <p class="sub">Generation runs in the background. Finished designs wait in Generated Results until you review them.</p>
    <div class="grid2">
      <div class="field"><label>How many designs</label><input class="input" id="aiCount" type="number" min="1" max="${remainingSlots()}" value="1"></div>
      <div class="field"><label>Target shirt color</label><select class="input" id="aiShirt"><option value="any" selected>Any color shirt</option><option value="black">Black shirt</option><option value="white">White shirt</option><option value="gray">Gray / neutral</option></select></div>
    </div>
    <div class="field"><label>Design or niche prompt</label><textarea class="input" id="aiPrompt" placeholder="Retro pickleball club shirt with bold readable text"></textarea></div>
    <div class="grid2">
      <div class="field"><label>Words on design <span class="opt">optional</span></label><input class="input" id="aiPhrase" placeholder="Serve It Up"></div>
      <div class="field"><label>Niche <span class="opt">optional</span></label><input class="input" id="aiNiche" placeholder="pickleball, lake life, teacher"></div>
    </div>
    <div class="field"><label>Title / keyword direction <span class="opt">optional</span></label><input class="input" id="aiMetaDir" placeholder="Aim for giftable Etsy search phrases"></div>
    <div class="actions"><button class="btn" id="runAiBtn">Generate in Background</button><span class="dim">Copyright filter is ${state.copyrightFilter.toUpperCase()}.</span></div>`;
  document.getElementById("runAiBtn").onclick = runAiGenerate;
}

async function runAiGenerate() {
  const count = Math.max(1, Math.min(Number(document.getElementById("aiCount").value || 1), remainingSlots(), MAX_BATCH));
  const prompt = document.getElementById("aiPrompt").value.trim();
  const phrase = document.getElementById("aiPhrase").value.trim();
  const niche = document.getElementById("aiNiche").value.trim();
  const metadataDirection = document.getElementById("aiMetaDir").value.trim();
  const shirtColorTarget = document.getElementById("aiShirt")?.value || "any";
  if (!remainingSlots()) {
    showToolMessage("The batch is full. Remove a design before generating more.", "warn");
    return;
  }
  if (!prompt && !phrase && !niche) {
    showToolMessage("Add a prompt, phrase, or niche before generating.", "warn");
    return;
  }
  try {
    const response = await fetch("/api/generation-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        count,
        prompt,
        designPhrase: phrase,
        niche,
        shirtColorTarget,
        metadataDirection,
        copyrightFilter: state.copyrightFilter,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Generation job failed to start.");
    if (!activeQueueSummary()) {
      state.generationJobs = [];
      state.dismissedToasts = {};
    }
    upsertJob(data.job);
    renderAll();
    saveState();
    startPolling();
    els.toolPanel.hidden = false;
    els.toolPanel.innerHTML = `<div class="notice info">Generation started in the background. You can keep using Inkly while it works.</div>
      <div class="actions"><button class="btn ghost" id="anotherAiBtn">Add another generation</button></div>`;
    document.getElementById("anotherAiBtn").onclick = renderAiTool;
  } catch (err) {
    showToolMessage(err.message || "Generation job failed to start.", "warn");
  }
}

function renderSimilarTool() {
  els.toolPanel.innerHTML = `<h2>Generate Similar Design from Screenshot</h2>
    <p class="sub">Upload a screenshot. Inkly will generate 1 similar design in the background with an Etsy title and 13 keywords.</p>
    ${dropMarkup("similarDrop", "similarInput", "Upload screenshot", "PNG, JPG, JPEG or WEBP")}
    <div class="actions"><span class="dim" id="similarHint">The result will appear in Generated Results for review.</span></div>`;
  wireDrop("similarDrop", "similarInput", /image\/(png|jpe?g|webp)/, runSimilarUpload);
}

async function runSimilarUpload(file) {
  if (!remainingSlots()) {
    showToolMessage("The batch is full. Remove a design before generating another.", "warn");
    return;
  }
  try {
    showToolMessage("Uploading screenshot and starting a background similar-design job.");
    const upload = await uploadFile("/api/upload", file);
    const response = await fetch("/api/generation-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        count: 1,
        referenceMode: "similar_new_design",
        uploadedFile: upload.uploadedFile,
        shirtColorTarget: "any",
        copyrightFilter: state.copyrightFilter,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Similar design job failed to start.");
    if (!activeQueueSummary()) {
      state.generationJobs = [];
      state.dismissedToasts = {};
    }
    upsertJob(data.job);
    renderAll();
    saveState();
    startPolling();
    showToolMessage("Similar design generation started in the background. It will appear in Generated Results with a title and 13 keywords.");
  } catch (err) {
    showToolMessage(err.message || "Similar design job failed to start.", "warn");
  }
}

function renderCleanupTool() {
  els.toolPanel.innerHTML = `<h2>Clean Up Existing Design</h2>
    <div class="notice">This feature is temporarily offline and will return soon. Use <strong>AI Generate Design</strong> or <strong>Upload Ready PNG</strong> to add designs to your batch in the meantime.</div>`;
}

async function runCleanupUpload(file) {
  if (!remainingSlots()) {
    showToolMessage("The batch is full. Remove a design before cleaning another.", "warn");
    return;
  }
  showProc("Cleaning your design", "Removing background, upscaling, and formatting the PNG.");
  const upload = await uploadFile("/api/upload", file);
  const project = await postJson("/api/process-cleanup", {
    jobId: upload.jobId,
    uploadedFile: upload.uploadedFile,
    copyrightFilter: state.copyrightFilter,
  });
  openMetadata({
    pending: {
      jobId: project.id,
      imageUrl: project.output_url,
      title: "",
      keywords: [],
      source_type: "cleaned_existing",
      status: "ready",
    },
  });
}

const MAX_READY_UPLOADS = 15;

function renderReadyTool() {
  state.readyReview = null;
  els.toolPanel.innerHTML = `<h2>Upload Ready PNG Designs</h2>
    <p class="sub">Drag and drop up to ${MAX_READY_UPLOADS} finished transparent PNGs, or click to select them. No AI generation or cleanup will run.</p>
    ${dropMarkup("readyDrop", "readyInput", "Upload Ready PNG Designs", `PNG only • up to ${MAX_READY_UPLOADS} files at a time • up to 60 MB each • max 16,000 px per side. Unusual PNGs (16-bit, interlaced, embedded profiles) are converted automatically.`)}
    <div class="actions"><span class="dim" id="readyHint">Each design needs a title and 13 keywords before it can join the batch.</span></div>`;
  wireDrop("readyDrop", "readyInput", /image\/png/, runReadyUploads, "Please upload PNG files.", { multiple: true });
}

// Upload the dropped PNGs a few at a time (the server endpoint takes a single
// file per request), then open the review modal where each design gets its
// title + 13 keywords before anything is added to the batch.
const READY_UPLOAD_CONCURRENCY = 3;

async function runReadyUploads(files) {
  const hint = document.getElementById("readyHint");
  let selected = files;
  if (selected.length > MAX_READY_UPLOADS) {
    showToolMessage(`You can upload up to ${MAX_READY_UPLOADS} designs at a time — using the first ${MAX_READY_UPLOADS}.`, "warn");
    selected = selected.slice(0, MAX_READY_UPLOADS);
  }
  const slots = remainingSlots();
  if (!slots) {
    showToolMessage("The batch is full. Remove a design before uploading more.", "warn");
    return;
  }
  if (selected.length > slots) {
    showToolMessage(`Only ${slots} batch slot${slots === 1 ? "" : "s"} left — uploading the first ${slots} design${slots === 1 ? "" : "s"}.`, "warn");
    selected = selected.slice(0, slots);
  }

  // Small worker pool: uploads run 3 at a time; results land in their drop
  // slot so the review modal keeps the original order. Confirm dialogs wait
  // until every upload has settled — a window.confirm mid-pool would freeze
  // the other in-flight uploads' progress reporting.
  const results = new Array(selected.length);
  let cursor = 0;
  let done = 0;
  if (hint) hint.textContent = `Uploading… 0 of ${selected.length} done`;
  await Promise.all(
    Array.from({ length: Math.min(READY_UPLOAD_CONCURRENCY, selected.length) }, async () => {
      while (cursor < selected.length) {
        const index = cursor++;
        try {
          results[index] = { project: await uploadFile("/api/upload-ready-png", selected[index]) };
        } catch (err) {
          results[index] = { error: err };
        }
        done += 1;
        if (hint) hint.textContent = `Uploading… ${done} of ${selected.length} done`;
      }
    }),
  );

  const items = [];
  const failures = [];
  for (let index = 0; index < selected.length; index++) {
    const file = selected[index];
    const { project, error } = results[index] || {};
    if (error || !project) {
      failures.push(`${file.name}: ${error?.message || "upload failed"}`);
      continue;
    }
    // A nearly-opaque PNG is usually an accident (screenshot, design with a
    // baked-in background) — DTF printing needs transparency. Confirm
    // before it enters the batch.
    if (typeof project.alphaCoverage === "number" && project.alphaCoverage > 0.85) {
      const keep = window.confirm(
        `"${file.name}" looks ${Math.round(project.alphaCoverage * 100)}% opaque — it may have a solid background baked in (like a screenshot). DTF prints need transparency.\n\nAdd it to the batch anyway?`,
      );
      if (!keep) {
        failures.push(`${file.name}: skipped — looked opaque (no transparent background).`);
        continue;
      }
    }
    items.push({
      jobId: project.id,
      imageUrl: project.output_url,
      fileName: file.name,
      title: "",
      keywords: [],
      source_type: "uploaded_ready_png",
      status: "ready",
      note: project.hasAlpha ? "" : "No transparency detected. Export is still allowed.",
    });
  }
  if (hint) hint.textContent = "Each design needs a title and 13 keywords before it can join the batch.";
  const input = document.getElementById("readyInput");
  if (input) input.value = "";

  if (failures.length) {
    showToolMessage(`${failures.length} upload${failures.length === 1 ? "" : "s"} failed: ${failures.join(" · ")}`, "warn");
  }
  if (!items.length) return;

  state.readyReview = { items, index: 0 };
  openReadyReview();
}

// ---- Ready-design review modal (multi-upload metadata editor) ---------------

function readyItemComplete(item) {
  return Boolean(String(item.title || "").trim()) && (item.keywords || []).length === 13;
}

function openReadyReview() {
  els.readyReviewModal.hidden = false;
  renderReadyReview();
  setTimeout(() => els.readyReviewTitleInput.focus(), 30);
}

function closeReadyReview() {
  els.readyReviewModal.hidden = true;
  state.readyReview = null;
}

function renderReadyReview() {
  const review = state.readyReview;
  if (!review || !review.items.length) return;
  const item = review.items[review.index];
  const total = review.items.length;

  els.readyReviewHeading.textContent = `Design ${review.index + 1} of ${total}`;
  els.readyReviewImg.src = item.imageUrl;
  els.readyReviewNote.textContent = item.note || item.fileName || "Uploaded PNG";
  els.readyReviewTitleInput.value = item.title || "";
  els.readyReviewKeywordsInput.value = (item.keywords || []).join("\n");
  els.readyPrevBtn.disabled = review.index === 0;
  els.readyNextBtn.disabled = review.index === total - 1;

  // Progress dots: one per design, green when complete, click to jump.
  els.readyReviewProgress.innerHTML = review.items
    .map((entry, index) => `<button type="button" class="dot ${readyItemComplete(entry) ? "done" : ""} ${index === review.index ? "active" : ""}" data-index="${index}" title="Design ${index + 1}${readyItemComplete(entry) ? " — complete" : " — needs metadata"}">${index + 1}</button>`)
    .join("");
  els.readyReviewProgress.querySelectorAll(".dot").forEach((dot) => {
    dot.onclick = () => {
      review.index = Number(dot.dataset.index);
      renderReadyReview();
    };
  });

  updateReadyReviewStatus();
}

// Refresh the per-design keyword counter, the overall help line, and the
// gated Add button without re-rendering the inputs (so typing never loses
// focus or cursor position).
function updateReadyReviewStatus() {
  const review = state.readyReview;
  if (!review) return;
  const item = review.items[review.index];
  const total = review.items.length;
  const completeCount = review.items.filter(readyItemComplete).length;

  els.readyReviewKeywordStatus.textContent = `${(item.keywords || []).length} / 13 keywords`;
  const messages = [];
  if (!String(item.title || "").trim()) messages.push("Title is required.");
  if ((item.keywords || []).length !== 13) messages.push(`${(item.keywords || []).length} / 13 keywords entered.`);
  els.readyReviewHelp.textContent = messages.length
    ? messages.join(" ")
    : (completeCount === total ? "All designs are ready to add." : "This design is ready — use the arrows to finish the others.");

  els.readyReviewProgress.querySelectorAll(".dot").forEach((dot, index) => {
    dot.classList.toggle("done", readyItemComplete(review.items[index]));
  });

  // The whole point of the gate: nothing is added until EVERY design has a
  // title and exactly 13 keywords.
  els.readyReviewAddAllBtn.disabled = completeCount !== total;
  els.readyReviewAddAllBtn.textContent =
    completeCount === total
      ? `Add ${total} Design${total === 1 ? "" : "s"} to Batch`
      : `Add Designs to Batch (${completeCount} / ${total} ready)`;
}

function shiftReadyReview(delta) {
  const review = state.readyReview;
  if (!review) return;
  const next = review.index + delta;
  if (next < 0 || next >= review.items.length) return;
  review.index = next;
  renderReadyReview();
}

function addReadyReviewToBatch() {
  const review = state.readyReview;
  if (!review || !review.items.every(readyItemComplete)) return;
  if (review.items.length > remainingSlots()) {
    els.readyReviewHelp.textContent = `Only ${remainingSlots()} batch slot${remainingSlots() === 1 ? "" : "s"} left. Remove designs from the batch first.`;
    return;
  }
  let added = 0;
  for (const item of review.items) {
    const { fileName, ...rest } = item;
    if (addItem({ ...rest, title: String(item.title).trim() })) added += 1;
  }
  showToastMessage(`${added} design${added === 1 ? "" : "s"} added to the current batch.`);
  closeReadyReview();
}

els.readyReviewTitleInput.addEventListener("input", () => {
  const review = state.readyReview;
  if (!review) return;
  review.items[review.index].title = els.readyReviewTitleInput.value;
  updateReadyReviewStatus();
});
els.readyReviewKeywordsInput.addEventListener("input", () => {
  const review = state.readyReview;
  if (!review) return;
  review.items[review.index].keywords = parseKeywords(els.readyReviewKeywordsInput.value);
  updateReadyReviewStatus();
});
els.readyPrevBtn.onclick = () => shiftReadyReview(-1);
els.readyNextBtn.onclick = () => shiftReadyReview(1);
els.readyReviewAddAllBtn.onclick = addReadyReviewToBatch;
els.readyReviewCancelBtn.onclick = closeReadyReview;
els.closeReadyReviewBtn.onclick = closeReadyReview;

function dropMarkup(dropId, inputId, title, sub) {
  return `<div class="dz compact-dz" id="${dropId}">
    <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg></div>
    <h3>${title}</h3><p>${sub}</p>
    <input type="file" id="${inputId}" hidden>
  </div>`;
}

function wireDrop(dropId, inputId, regex, callback, invalidMessage = "Please upload a supported image file.", { multiple = false } = {}) {
  const drop = document.getElementById(dropId);
  const input = document.getElementById(inputId);
  if (multiple) input.setAttribute("multiple", "");
  drop.onclick = () => input.click();
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("drag");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("drag");
    if (multiple) handleDroppedFiles(Array.from(event.dataTransfer.files || []));
    else if (event.dataTransfer.files[0]) handleDroppedFile(event.dataTransfer.files[0]);
  });
  input.addEventListener("change", (event) => {
    if (multiple) handleDroppedFiles(Array.from(event.target.files || []));
    else if (event.target.files[0]) handleDroppedFile(event.target.files[0]);
  });
  // Multi-file mode: the valid files go to the callback as an array; invalid
  // types are skipped with a warning instead of aborting the whole drop.
  async function handleDroppedFiles(files) {
    if (!files.length) return;
    const valid = files.filter((file) => regex.test(file.type));
    if (!valid.length) {
      showToolMessage(invalidMessage, "warn");
      return;
    }
    if (valid.length < files.length) {
      showToolMessage(`${files.length - valid.length} file(s) skipped — ${invalidMessage}`, "warn");
    }
    try {
      await callback(valid);
    } catch (err) {
      reportDropError(err);
    }
  }
  function reportDropError(err) {
    go("workspace");
    if (state.activeTool) renderTool(state.activeTool);
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.textContent = err.message || "Something went wrong.";
    els.toolPanel.prepend(notice);
  }
  async function handleDroppedFile(file) {
    if (!regex.test(file.type)) {
      showToolMessage(invalidMessage, "warn");
      return;
    }
    try {
      await callback(file);
    } catch (err) {
      // Show the server's message inline (above the re-rendered tool) so the
      // user can read what to fix and immediately retry in the same drop zone.
      reportDropError(err);
    }
  }
}

async function uploadFile(url, file) {
  const fd = new FormData();
  fd.append("file", file);
  const response = await fetch(url, { method: "POST", body: fd });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload failed.");
  return data.project || data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data.project || data;
}

function showProc(title, sub) {
  els.procTitle.textContent = title;
  els.procSub.textContent = sub;
  go("processing");
}

function addItem(item) {
  if (!remainingSlots()) return false;
  state.batch.push({ localId: uid(), keywords: [], ...item });
  renderAll();
  saveState();
  return true;
}

function openMetadata({ item = null, pending = null, editing = false }) {
  state.pendingMetadata = pending;
  state.editingId = item?.localId || null;
  const target = item || pending;
  els.metadataEyebrow.textContent = editing ? "Edit metadata" : "Required metadata";
  els.metadataTitle.textContent = editing ? "Edit design metadata" : "Add title and keywords";
  els.metadataPreview.src = target.imageUrl;
  els.metaTitleInput.value = target.title || "";
  els.metaKeywordsInput.value = Array.isArray(target.keywords) ? target.keywords.join("\n") : "";
  updateMetadataHelp();
  els.metadataModal.hidden = false;
  setTimeout(() => els.metaTitleInput.focus(), 30);
}

function closeMetadata() {
  els.metadataModal.hidden = true;
  state.pendingMetadata = null;
  state.editingId = null;
  if (navStack[navStack.length - 1] === "processing") go("workspace");
}

els.metaTitleInput.addEventListener("input", updateMetadataHelp);
els.metaKeywordsInput.addEventListener("input", updateMetadataHelp);
els.closeMetadataBtn.onclick = closeMetadata;
els.cancelMetadataBtn.onclick = closeMetadata;
els.previewTitleInput.addEventListener("input", updatePreviewHelp);
els.previewKeywordsInput.addEventListener("input", updatePreviewHelp);
els.closePreviewBtn.onclick = closePreviewModal;
els.previewCloseBtn.onclick = closePreviewModal;
els.previewSaveBtn.onclick = savePreviewMetadata;
els.previewAddBtn.onclick = addPreviewToBatch;
els.previewDiscardBtn.onclick = discardPreviewItem;

function updateMetadataHelp() {
  const title = els.metaTitleInput.value.trim();
  const keywords = parseKeywords(els.metaKeywordsInput.value);
  const messages = [];
  if (!title) messages.push("Title is required.");
  if (keywords.length !== 13) messages.push(`${keywords.length} / 13 keywords entered.`);
  els.metadataHelp.textContent = messages.length ? messages.join(" ") : "Ready: title plus exactly 13 keywords.";
}

els.saveMetadataBtn.onclick = () => {
  const title = els.metaTitleInput.value.trim();
  const keywords = parseKeywords(els.metaKeywordsInput.value);
  if (!title || keywords.length !== 13) {
    updateMetadataHelp();
    return;
  }
  if (state.editingId) {
    const item = state.batch.find((x) => x.localId === state.editingId);
    if (item) {
      item.title = title;
      item.keywords = keywords;
    }
  } else if (state.pendingMetadata) {
    if (!addItem({ ...state.pendingMetadata, title, keywords })) {
      els.metadataHelp.textContent = "The batch is full. Remove a design before adding this one.";
      return;
    }
  }
  closeMetadata();
  renderAll();
  saveState();
  go("batch");
};

function previewTarget() {
  if (!state.previewContext) return null;
  const list = state.previewContext.kind === "batch" ? state.batch : state.generatedResults;
  return list.find((item) => item.localId === state.previewContext.localId) || null;
}

function openPreviewModal(context) {
  state.previewContext = context;
  const item = previewTarget();
  if (!item) return;
  const isBatch = context.kind === "batch";
  els.previewEyebrow.textContent = isBatch ? "Current batch" : "Generated result";
  els.previewHeading.textContent = item.title || "Untitled design";
  els.previewFullImg.src = item.imageUrl;
  els.previewSourceType.textContent = SOURCES[item.source_type] || item.source_type || "Source";
  els.previewTitleInput.value = item.title || "";
  els.previewKeywordsInput.value = Array.isArray(item.keywords) ? item.keywords.join("\n") : "";
  els.previewAddBtn.hidden = isBatch;
  els.previewDiscardBtn.textContent = isBatch ? "Remove" : "Discard";
  updatePreviewHelp();
  els.previewModal.hidden = false;
}

function closePreviewModal() {
  els.previewModal.hidden = true;
  state.previewContext = null;
}

function updatePreviewHelp() {
  const title = els.previewTitleInput.value.trim();
  const keywords = parseKeywords(els.previewKeywordsInput.value);
  els.previewKeywordStatus.textContent = `${keywords.length} / 13 keywords`;
  const messages = [];
  if (!title) messages.push("Title is required.");
  if (keywords.length !== 13) messages.push(`${keywords.length} / 13 keywords entered.`);
  els.previewHelp.textContent = messages.length ? messages.join(" ") : "Ready: title plus exactly 13 keywords.";
}

function savePreviewMetadata() {
  const item = previewTarget();
  if (!item) return false;
  const title = els.previewTitleInput.value.trim();
  const keywords = parseKeywords(els.previewKeywordsInput.value);
  if (!title || keywords.length !== 13) {
    updatePreviewHelp();
    return false;
  }
  item.title = title;
  item.keywords = keywords;
  els.previewHeading.textContent = title;
  renderAll();
  saveState();
  updatePreviewHelp();
  return true;
}

function addPreviewToBatch() {
  if (!state.previewContext || state.previewContext.kind !== "result") return;
  if (!savePreviewMetadata()) return;
  const card = document.querySelector(`[data-result-card="${state.previewContext.localId}"]`);
  const localId = state.previewContext.localId;
  closePreviewModal();
  addGeneratedResult(localId, card);
}

function discardPreviewItem() {
  if (!state.previewContext) return;
  const { kind, localId } = state.previewContext;
  if (kind === "batch") {
    state.batch = state.batch.filter((item) => item.localId !== localId);
  } else {
    state.generatedResults = state.generatedResults.filter((item) => item.localId !== localId);
  }
  closePreviewModal();
  renderAll();
  saveState();
}

function upsertJob(job) {
  if (!job?.id) return;
  const existing = state.generationJobs.findIndex((item) => item.id === job.id);
  const previous = existing >= 0 ? state.generationJobs[existing] : {};
  const merged = { ...previous, ...job, importedIds: previous.importedIds || [] };
  if (existing >= 0) state.generationJobs[existing] = merged;
  else state.generationJobs.push(merged);
  importJobResults(merged);
}

function importJobResults(job) {
  const imported = new Set(job.importedIds || []);
  const known = new Set([
    ...state.generatedResults.map((item) => item.jobId),
    ...state.batch.map((item) => item.jobId),
  ]);
  for (const project of job.results || []) {
    if (imported.has(project.id) || known.has(project.id)) continue;
    state.generatedResults.push({
      localId: uid(),
      jobId: project.id,
      imageUrl: project.output_url,
      title: project.listing?.title || "",
      keywords: project.listing?.keywords || [],
      source_type: project.mode === "similar_new_design" ? "similar_screenshot" : "ai_generated",
      status: "ready",
    });
    imported.add(project.id);
  }
  job.importedIds = Array.from(imported);
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollJobs, 1600);
  pollJobs();
}

async function pollJobs() {
  const active = activeJobs();
  if (!active.length) {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    renderJobToast();
    return;
  }
  for (const job of active) {
    try {
      const response = await fetch(`/api/generation-jobs/${job.id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Generation status failed.");
      upsertJob(data.job);
    } catch (err) {
      job.status = "failed";
      job.errors = [err.message || "Generation status failed."];
    }
  }
  renderAll();
  saveState();
}

function renderJobToast() {
  const active = activeQueueSummary();
  const latestDone = completedQueueSummary();
  const job = active || latestDone;
  if (!job) {
    els.jobToast.hidden = true;
    return;
  }
  const dismissKey = active ? "active" : job.status;
  if (state.dismissedToasts[job.id] === dismissKey) {
    els.jobToast.hidden = true;
    return;
  }
  const done = job.completed + job.failed;
  const pct = job.total ? Math.round((done / job.total) * 100) : 0;
  els.jobToast.hidden = false;
  els.jobToastTitle.textContent = active ? "Generating designs..." : job.status === "failed" ? "Generation failed" : "Generation complete";
  els.jobToastCount.textContent = `${done} of ${job.total}`;
  els.jobToastSub.textContent = active
    ? job.status === "queued" ? "Queued" : "Working in the background"
    : job.status === "failed" ? (job.errors?.[0] || "No designs were completed") : `${job.completed} design${job.completed === 1 ? "" : "s"} ready to review`;
  els.jobToastBar.style.width = `${pct}%`;
  els.jobToastAction.hidden = active || job.completed === 0;
}

function dismissJobToast() {
  const active = activeQueueSummary();
  const latestDone = completedQueueSummary();
  const job = active || latestDone;
  if (!job) return;
  state.dismissedToasts[job.id] = active ? "active" : job.status;
  els.jobToast.hidden = true;
  saveState();
}

els.exportBatchBtn.onclick = async () => {
  const invalid = state.batch.find((item) => itemReadiness(item) !== "Ready");
  if (invalid) {
    openMetadata({ item: invalid, editing: true });
    return;
  }
  try {
    els.exportBatchBtn.disabled = true;
    els.exportBatchBtn.textContent = "Exporting...";
    const exportItems = state.batch.map((item) => ({
      jobId: item.jobId,
      title: item.title,
      keywords: item.keywords,
      source_type: item.source_type,
    }));
    let response = await fetch("/api/export-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: exportItems }),
    });
    if (response.status === 409) {
      // Designs that skipped QA review (reviewer outage) need an explicit
      // operator decision — the human is the safety net here.
      const data = await response.json().catch(() => ({}));
      const proceed = window.confirm(
        `${data.error || "Some designs skipped QA review."}\n\nInclude them in the export anyway? Double-check their spelling and layout first.`,
      );
      if (!proceed) throw new Error("Export canceled — review the flagged designs and try again.");
      response = await fetch("/api/export-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: exportItems, allowUnreviewed: true }),
      });
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Export failed.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inkly_batch.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message || "Export failed.");
  } finally {
    els.exportBatchBtn.textContent = "Export Batch";
    renderAll();
  }
};

fetch("/api/status").then((response) => response.json()).then((status) => {
  els.statusPill.textContent = status.aiEnabled ? "AI enabled · batch ZIP" : "Demo mode · add OpenAI key";
  if (status.superResolution) els.statusPill.textContent += " · SR on";
}).catch(() => {});

loadState();
renderAll();
startPolling();
verifyStoredDesigns();

// After a Render restart/deploy (or ~15 idle minutes on free hosting, which
// spins the instance down) the server's design files are gone while
// localStorage still lists them. Detect that on load, drop the dead items,
// and tell the user their batch expired — otherwise they see broken
// previews and an export that would fail.
async function verifyStoredDesigns() {
  const ids = [...new Set(
    [...state.batch, ...state.generatedResults].map((item) => item.jobId).filter(Boolean),
  )];
  if (!ids.length) return;
  let missing;
  try {
    const response = await fetch("/api/designs/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.missing) || !data.missing.length) return;
    missing = new Set(data.missing);
  } catch {
    // Offline or unauthenticated — never destroy saved work on a failed check.
    return;
  }
  const before = state.batch.length + state.generatedResults.length;
  state.batch = state.batch.filter((item) => !item.jobId || !missing.has(item.jobId));
  state.generatedResults = state.generatedResults.filter((item) => !item.jobId || !missing.has(item.jobId));
  const dropped = before - (state.batch.length + state.generatedResults.length);
  if (!dropped) return;
  saveState();
  renderAll();
  showExpiredBatchNotice(dropped);
}

function showExpiredBatchNotice(count) {
  showToastMessage(`Batch expired — ${count} design${count === 1 ? "" : "s"} removed.`);
  const hosts = [document.getElementById("screen-workspace"), document.getElementById("screen-home")].filter(Boolean);
  for (const host of hosts) {
    let notice = host.querySelector(".expired-batch-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "notice expired-batch-notice";
      host.prepend(notice);
    }
    notice.innerHTML = "";
    const text = document.createElement("span");
    text.textContent =
      `Your previous batch expired: ${count} design${count === 1 ? " is" : "s are"} no longer valid. ` +
      `The server restarted and cleared its design files (this happens after a deploy, or after ~15 idle minutes on free hosting). ` +
      `The expired designs were removed — regenerate or re-upload them, and export your batch in one sitting.`;
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "notice-dismiss";
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.textContent = "×";
    dismiss.onclick = () => document.querySelectorAll(".expired-batch-notice").forEach((n) => n.remove());
    notice.append(text, dismiss);
  }
}
