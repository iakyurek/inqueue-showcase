"use client";

// Pending-batches folder configuration: save the folder ID server-side
// (AppSetting), run a read-only access test, or scan for batch folders.
// Never calls draft-creation endpoints and never performs Drive writes.

import { useState } from "react";

interface EffectiveSetting {
  value: string | null;
  source: "db" | "env" | null;
}

interface LastTest {
  ok: boolean;
  folderId: string;
  folderName?: string;
  folderCount?: number;
  checkedAt: string;
  error?: string;
}

interface LastScan {
  at: string;
  folderCount: number;
  error: string | null;
}

function formatWhen(iso: string | undefined | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export function DrivePendingFolderCard({
  initialSetting,
  initialLastTest,
  initialLastScan,
  driveConnected,
}: {
  initialSetting: EffectiveSetting;
  initialLastTest: LastTest | null;
  initialLastScan: LastScan | null;
  driveConnected: boolean;
}) {
  const [folderId, setFolderId] = useState(initialSetting.value ?? "");
  const [source, setSource] = useState(initialSetting.source);
  const [lastTest, setLastTest] = useState<LastTest | null>(initialLastTest);
  const [lastScan, setLastScan] = useState<LastScan | null>(initialLastScan);
  const [busy, setBusy] = useState<"save" | "test" | "scan" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save() {
    setBusy("save");
    setNotice(null);
    try {
      const res = await fetch("/api/settings/app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleDrivePendingFolderId: folderId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ kind: "error", text: `${data.error ?? "Save failed."} ${data.fix ?? ""}`.trim() });
        return;
      }
      setFolderId(data.googleDrivePendingFolderId.value ?? "");
      setSource(data.googleDrivePendingFolderId.source);
      setNotice({
        kind: "ok",
        text: data.googleDrivePendingFolderId.source === "env"
          ? "Saved. Cleared the stored value — using the environment variable."
          : data.googleDrivePendingFolderId.source === "db"
            ? "Folder ID saved."
            : "Saved. No folder configured yet.",
      });
    } catch {
      setNotice({ kind: "error", text: "Save failed — Batchly server unreachable." });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setNotice(null);
    try {
      const res = await fetch("/api/drive/test-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(folderId.trim() ? { folderId: folderId.trim() } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ kind: "error", text: `${data.error ?? "Test failed."} ${data.fix ?? ""}`.trim() });
        return;
      }
      setLastTest(data);
      setNotice(
        data.ok
          ? { kind: "ok", text: `Folder "${data.folderName}" is accessible (${data.folderCount} batch folders visible).` }
          : { kind: "error", text: data.error ?? "Folder test failed." },
      );
    } catch {
      setNotice({ kind: "error", text: "Test failed — Batchly server unreachable." });
    } finally {
      setBusy(null);
    }
  }

  async function scan() {
    setBusy("scan");
    setNotice(null);
    try {
      const res = await fetch("/api/batches/scan-drive", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setNotice({
          kind: "error",
          text:
            data.error === "NOT_CONNECTED"
              ? "Connect Google Drive first."
              : data.error === "PENDING_FOLDER_NOT_CONFIGURED"
                ? "Save a pending-batches folder ID first."
                : data.detail ?? data.error ?? "Scan failed.",
        });
        return;
      }
      const scanResult = {
        at: new Date().toISOString(),
        folderCount: data.batches?.length ?? 0,
        error: null,
      };
      setLastScan(scanResult);
      setNotice({ kind: "ok", text: `Scan complete — ${scanResult.folderCount} batch folders found.` });
    } catch {
      setNotice({ kind: "error", text: "Scan failed — Batchly server unreachable." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="py-4 border-b border-white/[0.07] last:border-0 space-y-3">
      <div className="space-y-1">
        <p className="text-[13px] text-slate-200 font-medium">Pending batches folder</p>
        <p className="text-[12px] text-slate-500 leading-relaxed">
          The Drive folder containing pending batch subfolders from Preply.
          {source === "env" && " Currently using the GOOGLE_DRIVE_PENDING_FOLDER_ID environment variable — saving here overrides it."}
          {source === "db" && " Saved in Batchly settings (overrides the environment variable)."}
          {source === null && " Not configured — paste the folder ID from the Drive folder URL."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          placeholder="Drive folder ID"
          className="flex-1 min-w-[240px] px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[12px] font-mono text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-slate-500"
        />
        <button
          onClick={save}
          disabled={busy !== null}
          className="px-3 py-1.5 rounded-lg bg-slate-700/80 border border-slate-600/50 text-xs text-slate-100 font-semibold hover:bg-slate-600/80 transition-colors disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button
          onClick={test}
          disabled={busy !== null || !driveConnected}
          title={driveConnected ? undefined : "Connect Google Drive first"}
          className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.1] text-xs text-slate-300 font-semibold hover:bg-white/[0.08] transition-colors disabled:opacity-50"
        >
          {busy === "test" ? "Testing…" : "Test Folder"}
        </button>
        <button
          onClick={scan}
          disabled={busy !== null || !driveConnected}
          title={driveConnected ? undefined : "Connect Google Drive first"}
          className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.1] text-xs text-slate-300 font-semibold hover:bg-white/[0.08] transition-colors disabled:opacity-50"
        >
          {busy === "scan" ? "Scanning…" : "Scan Pending Batches"}
        </button>
      </div>

      {notice && (
        <p className={`text-[12px] ${notice.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>
          {notice.text}
        </p>
      )}

      <div className="space-y-0.5">
        {lastTest && (
          <p className="text-[11px] text-slate-500">
            Last folder test: {lastTest.ok ? `passed (${lastTest.folderName ?? lastTest.folderId})` : `failed — ${lastTest.error}`}
            {" · "}{formatWhen(lastTest.checkedAt)}
          </p>
        )}
        {lastScan && (
          <p className="text-[11px] text-slate-500">
            Last scan: {lastScan.error ? `failed — ${lastScan.error}` : `${lastScan.folderCount} batch folders`}
            {" · "}{formatWhen(lastScan.at)}
          </p>
        )}
      </div>
    </div>
  );
}
