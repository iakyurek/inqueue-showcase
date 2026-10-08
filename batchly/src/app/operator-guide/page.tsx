import { TopBar } from "@/components/layout/TopBar";

interface StepProps {
  number: number;
  title: string;
  children: React.ReactNode;
}

function Step({ number, title, children }: StepProps) {
  return (
    <div className="flex gap-4">
      <div className="shrink-0 w-7 h-7 rounded-full bg-white/[0.06] border border-white/[0.12] flex items-center justify-center text-xs font-bold text-slate-300">
        {number}
      </div>
      <div className="flex-1 pb-6 border-l border-white/[0.07] pl-4 -ml-3.5">
        <p className="text-[14px] font-semibold text-slate-200 mb-1.5">{title}</p>
        <div className="text-[13px] text-slate-400 space-y-1.5 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-500/[0.2] bg-amber-950/[0.25] px-3 py-2.5 text-[12px] text-amber-300 leading-relaxed">
      {children}
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-sky-500/[0.2] bg-sky-950/[0.25] px-3 py-2.5 text-[12px] text-sky-300 leading-relaxed">
      {children}
    </div>
  );
}

function SafetyBadge({ text }: { text: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-md bg-emerald-500/[0.1] border border-emerald-500/[0.25] text-[10px] text-emerald-400 font-semibold">
      {text}
    </span>
  );
}

export default function OperatorGuidePage() {
  return (
    <div className="flex flex-col flex-1 bg-[#0f1115]">
      <TopBar
        dark
        title="Operator Guide"
        subtitle="How to run a batch"
      />
      <div className="p-6 max-w-3xl space-y-8">

        {/* Safety banner */}
        <div className="rounded-xl border border-emerald-500/[0.2] bg-emerald-500/[0.06] px-5 py-4 space-y-2.5">
          <p className="text-[14px] font-semibold text-emerald-400">Batchly is draft-only.</p>
          <p className="text-[13px] text-emerald-300/80 leading-relaxed">
            No listings are ever published or activated by Batchly. Every listing created here is an Etsy{" "}
            <span className="font-semibold">draft</span> that must be manually reviewed and
            published inside Etsy by the shop owner.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <SafetyBadge text="Draft only" />
            <SafetyBadge text="No publishing" />
            <SafetyBadge text="No activation" />
            <SafetyBadge text="Max 30/store" />
            <SafetyBadge text="Duplicate protection" />
            <SafetyBadge text="Manual confirm required" />
          </div>
        </div>

        {/* One-time setup */}
        <div>
          <h2 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-4">One-Time Setup (per store)</h2>
          <div className="space-y-0">
            <Step number={1} title="Connect each store via Etsy OAuth">
              <p>
                Go to <span className="font-mono text-slate-300">/stores</span> and click{" "}
                <span className="font-semibold text-slate-300">Connect Etsy account</span> for each store.
                Complete the OAuth flow. The store will show a green{" "}
                <span className="font-semibold text-emerald-400">Connected</span> badge with a shop name.
              </p>
            </Step>

            <Step number={2} title="Save Etsy IDs for each store">
              <p>
                Expand the <span className="font-semibold text-slate-300">Store Etsy IDs</span> panel on each store card and save:
              </p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li><span className="font-mono text-slate-300">taxonomyId</span> — use Taxonomy Search to find the right leaf node</li>
                <li><span className="font-mono text-slate-300">shippingProfileId</span> — found in Etsy Seller Dashboard → Shipping</li>
                <li><span className="font-mono text-slate-300">readinessStateId</span> — click &ldquo;Find or Create Made-to-Order Profile&rdquo;</li>
              </ul>
              <Note>
                A store will be skipped in batch runs if any of these IDs are missing. The validation dashboard will tell you.
              </Note>
            </Step>

            <Step number={3} title="Configure global settings">
              <p>
                Go to <span className="font-mono text-slate-300">/settings</span> and configure:
              </p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>
                  <span className="font-semibold text-slate-300">Listing Description Template</span> — shared description body for all listings.
                  The manifest row title is injected as the first line automatically. Must contain an ORDERING section.
                </li>
                <li>
                  <span className="font-semibold text-slate-300">Variation Preset</span> (optional) — size/color variations with Etsy property IDs and options. Leave disabled if not using variations.
                </li>
                <li>
                  <span className="font-semibold text-slate-300">Supplemental Images</span> (optional) — shared size chart and promo images appended after mockup images. Leave disabled if not using.
                </li>
              </ul>
            </Step>
          </div>
        </div>

        {/* Main workflow */}
        <div>
          <h2 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-4">
            Batch Workflow (run from <span className="font-mono text-slate-500">/batches</span>)
          </h2>
          <div className="space-y-0">
            <Step number={4} title="Upload batch to Google Drive">
              <p>
                Place the completed batch folder (containing <span className="font-mono text-slate-300">batch_manifest.csv</span> and store/design subfolders with mockup images) into the configured pending folder in Google Drive.
              </p>
              <p className="text-slate-500">
                The folder ID is set via <span className="font-mono">GOOGLE_DRIVE_PENDING_FOLDER_ID</span> in <span className="font-mono">.env.local</span>.
              </p>
            </Step>

            <Step number={5} title="Detect and download from Drive">
              <p>
                Go to <span className="font-mono text-slate-300">/batches</span> → Step 1{" "}
                <span className="font-semibold text-slate-300">Detect Drive Batches</span>.
                Click <span className="font-semibold text-slate-300">Download / Sync</span> for the batch.
              </p>
              <p>
                The batch is downloaded to <span className="font-mono text-slate-300">workspace/downloads/</span>.
                Already-downloaded files are skipped (idempotent).
              </p>
              <Tip>
                If Drive is not connected, go to Settings → Connect Google Drive first.
                Alternatively, place the batch folder directly in <span className="font-mono">workspace/downloads/</span> and skip this step.
              </Tip>
            </Step>

            <Step number={6} title="Validate the batch">
              <p>
                In Step 2, click <span className="font-semibold text-slate-300">Validate</span> next to the batch.
                The validation dashboard shows:
              </p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>Manifest row count and parse status</li>
                <li>Estimated new listings per store</li>
                <li>Duplicates that will be skipped (already created in a prior run)</li>
                <li>Per-store: Etsy connection, ID setup, eligible row count</li>
                <li>Variation and supplemental image readiness</li>
              </ul>
              <Note>
                Stores with missing IDs or Etsy connection errors are skipped automatically — they don&apos;t block other stores from running.
                Fix them in <span className="font-mono">/stores</span> and re-validate before adding them to the run.
              </Note>
            </Step>

            <Step number={7} title="Fix any issues before starting">
              <p>
                Common issues to fix before starting a run:
              </p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>Missing store IDs → go to <span className="font-mono text-slate-300">/stores</span> → Store Etsy IDs</li>
                <li>Store not connected → re-run OAuth</li>
                <li>Missing images → add to <span className="font-mono text-slate-300">workspace/downloads/&lt;batch&gt;/Store_X/D001/</span></li>
                <li>Variation issues → fix in <span className="font-mono text-slate-300">/settings</span></li>
                <li>No description template → add in <span className="font-mono text-slate-300">/settings</span> → Listing Preset</li>
              </ul>
              <p>Re-validate after fixing to confirm changes are picked up.</p>
            </Step>

            <Step number={8} title="Start the batch run">
              <p>
                Click <span className="font-semibold text-slate-300">Start Batch Run</span>.
                A confirmation dialog shows the full breakdown before proceeding:
              </p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>Which stores will run, with estimated listing counts</li>
                <li>How many duplicates will be skipped</li>
                <li>Whether variations and supplemental images are enabled</li>
              </ul>
              <p>
                Confirm to create the run. A <span className="font-semibold text-slate-300">BatchRun</span> record is created
                immediately and the step runner starts automatically.
              </p>
            </Step>

            <Step number={9} title="Watch progress in real time">
              <p>
                The progress panel shows:
              </p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>Overall percent complete bar and row counts</li>
                <li>Current store and design ID being processed</li>
                <li>Per-store progress bars and status</li>
                <li>Row-level table with design ID, SKU, status, and Etsy listing IDs</li>
              </ul>
              <Note>
                Keep the page open while the run is in progress — the step loop runs in the browser.
                If you close the page mid-run, reopen <span className="font-mono">/batches</span> and click the run in{" "}
                <span className="font-semibold text-slate-300">Recent Batch Runs</span> to resume viewing.
                The database keeps the state — rows already created are not re-created.
              </Note>
            </Step>

            <Step number={10} title="Retry failed rows if needed">
              <p>
                After completion, if any rows failed, a{" "}
                <span className="font-semibold text-slate-300">↺ Retry Failed Rows</span> button appears.
                Click it, confirm, and the failed rows are reset to queued and re-processed automatically.
              </p>
              <p>
                Retry is safe — rows that already succeeded are not re-processed.
                Duplicate protection ensures no listing is created twice.
              </p>
            </Step>

            <Step number={11} title="QA and review Etsy drafts">
              <p>
                After the run completes, the progress panel shows all created listing IDs.
                Open <span className="font-semibold text-slate-300">Etsy Seller Dashboard → Listings → Drafts</span> and verify:
              </p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>Status is Draft (not active)</li>
                <li>Title matches the manifest row</li>
                <li>Description has the template body</li>
                <li>Images are attached (mockup + supplemental if enabled)</li>
                <li>Variations are correct if enabled</li>
                <li>Shipping profile and processing time applied</li>
              </ul>
              <p>
                For per-listing QA, go to <span className="font-mono text-slate-300">/stores</span> → expand a store → use the{" "}
                <span className="font-semibold text-slate-300">Run QA for Draft</span> panel.
                Paste a listing ID to verify state, images, inventory, tags, and description.
              </p>
            </Step>

            <Step number={12} title="Manually publish from Etsy only — never from Batchly">
              <p>
                After QA, publish listings directly inside Etsy.
                Batchly has no publish or activate capability — this is intentional.
              </p>
              <p className="text-slate-500">
                If a draft needs corrections (wrong title, missing tags, wrong price), edit it in Etsy directly.
                Batchly cannot edit existing listings.
              </p>
            </Step>
          </div>
        </div>

        {/* Quick Reference */}
        <div className="rounded-xl border border-white/[0.07] bg-[#1b1e27] px-4 py-4 space-y-4">
          <h2 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Quick Reference</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1">
              <p className="text-slate-500 font-semibold text-[10px] uppercase tracking-wide">Safe in Batchly</p>
              <ul className="text-slate-500 space-y-0.5">
                <li className="flex gap-1.5"><span className="text-emerald-500">✓</span> Connect store via OAuth</li>
                <li className="flex gap-1.5"><span className="text-emerald-500">✓</span> Save Etsy IDs (taxonomy, shipping, readiness)</li>
                <li className="flex gap-1.5"><span className="text-emerald-500">✓</span> Download batch from Google Drive</li>
                <li className="flex gap-1.5"><span className="text-emerald-500">✓</span> Validate a batch (read-only)</li>
                <li className="flex gap-1.5"><span className="text-emerald-500">✓</span> Start a batch run (creates drafts only)</li>
                <li className="flex gap-1.5"><span className="text-emerald-500">✓</span> Retry failed rows</li>
                <li className="flex gap-1.5"><span className="text-emerald-500">✓</span> Run preflight check (read-only)</li>
                <li className="flex gap-1.5"><span className="text-emerald-500">✓</span> Run listing QA (read-only)</li>
                <li className="flex gap-1.5"><span className="text-emerald-500">✓</span> View run history</li>
              </ul>
            </div>
            <div className="space-y-1">
              <p className="text-slate-500 font-semibold text-[10px] uppercase tracking-wide">Do in Etsy — not in Batchly</p>
              <ul className="text-slate-500 space-y-0.5">
                <li className="flex gap-1.5"><span className="text-red-500">✗</span> Publishing or activating listings</li>
                <li className="flex gap-1.5"><span className="text-red-500">✗</span> Editing draft title, description, or tags</li>
                <li className="flex gap-1.5"><span className="text-red-500">✗</span> Deleting listings</li>
                <li className="flex gap-1.5"><span className="text-red-500">✗</span> Setting sale or promo prices</li>
                <li className="flex gap-1.5"><span className="text-red-500">✗</span> Adding images to existing listings</li>
                <li className="flex gap-1.5"><span className="text-red-500">✗</span> Managing orders or customers</li>
              </ul>
            </div>
          </div>
          <div className="pt-2 border-t border-white/[0.07] space-y-1 text-[10px] text-slate-500">
            <p><span className="font-mono text-slate-500">/batches</span> — primary batch workflow (detect → validate → run → progress → retry)</p>
            <p><span className="font-mono text-slate-500">/stores</span> — per-store setup, ID refresh, listing QA</p>
            <p><span className="font-mono text-slate-500">/settings</span> — global preset (description, variation, supplemental images)</p>
            <p><span className="font-mono text-slate-500">/operator-guide</span> — this page</p>
          </div>
        </div>

        {/* Troubleshooting */}
        <div className="rounded-xl border border-white/[0.07] bg-[#1b1e27] px-4 py-4 space-y-3">
          <h2 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Common Issues</h2>
          <div className="space-y-3 text-xs">
            <div>
              <p className="text-slate-300 font-semibold">Store is skipped in the run</p>
              <p className="text-slate-500 mt-0.5">The store is missing one or more Etsy IDs, or is not OAuth-connected. Check the validation dashboard per-store card, fix in /stores, and re-validate.</p>
            </div>
            <div>
              <p className="text-slate-300 font-semibold">Row fails with &ldquo;listing creation failed&rdquo;</p>
              <p className="text-slate-500 mt-0.5">Usually a bad Etsy ID or an invalid manifest value. Check the error in the expanded store card, fix the underlying data, and retry.</p>
            </div>
            <div>
              <p className="text-slate-300 font-semibold">Row status is &ldquo;partial&rdquo;</p>
              <p className="text-slate-500 mt-0.5">The draft was created but image upload, variation inventory, or supplemental image upload failed. The listing exists in Etsy — add missing images manually, or retry to re-attempt uploads.</p>
            </div>
            <div>
              <p className="text-slate-300 font-semibold">All rows show as duplicate</p>
              <p className="text-slate-500 mt-0.5">This batch was already run. Batchly&apos;s DraftCreationRecord table records every created listing. If you deleted the Etsy drafts and want to re-create them, the protection will still block re-creation (by design). Start a new batch with new design IDs.</p>
            </div>
            <div>
              <p className="text-slate-300 font-semibold">Progress stuck / step loop stopped</p>
              <p className="text-slate-500 mt-0.5">Close and reopen /batches. Find the run in Recent Batch Runs and click it. If rows are still queued, click Refresh Status. The database holds all state — the loop will resume from where it left off.</p>
            </div>
          </div>
        </div>

        {/* Back link */}
        <p className="text-xs text-slate-600">
          <a href="/batches" className="text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors">
            ← Back to Batches
          </a>
          {" · "}
          <a href="/stores" className="text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors">
            Stores
          </a>
          {" · "}
          <a href="/settings" className="text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors">
            Settings
          </a>
        </p>

      </div>
    </div>
  );
}
