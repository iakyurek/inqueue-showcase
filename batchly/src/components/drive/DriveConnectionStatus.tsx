"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Status = "loading" | "connected" | "not_connected" | "error";

export function DriveConnectionStatus() {
  const [status, setStatus] = useState<Status>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const searchParams = useSearchParams();

  const refresh = useCallback(() => {
    fetch("/api/drive/status")
      .then((r) => r.json())
      .then((data: { connected: boolean; email?: string | null; connectedAt?: string | null }) => {
        setStatus(data.connected ? "connected" : "not_connected");
        setEmail(data.email ?? null);
        setConnectedAt(data.connectedAt ?? null);
      })
      .catch(() => setStatus("not_connected"));
  }, []);

  useEffect(() => {
    const driveParam = searchParams.get("drive");
    if (driveParam === "error") {
      setStatus("error");
      setErrorReason(searchParams.get("reason"));
      return;
    }
    // Even when redirected back with ?drive=connected, fetch the full status
    // so the account email shows up.
    refresh();
  }, [searchParams, refresh]);

  async function disconnect() {
    if (!window.confirm("Disconnect Google Drive? Batch scanning will stop working until you reconnect.")) {
      return;
    }
    setDisconnecting(true);
    try {
      await fetch("/api/drive/disconnect", { method: "POST" });
      setEmail(null);
      setConnectedAt(null);
      setStatus("not_connected");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-6 py-5 border-b border-white/[0.07] last:border-0">
      <div className="space-y-1 min-w-0">
        <p className="text-sm text-slate-200 font-medium">Google Drive connection</p>
        <p className="text-xs text-slate-500 leading-relaxed">
          Connect your Google account to browse pending batch folders in Drive.
        </p>
        {status === "connected" && email && (
          <p className="text-xs text-slate-400">
            Connected as <span className="font-mono">{email}</span>
            {connectedAt && (
              <span className="text-slate-600"> · since {new Date(connectedAt).toLocaleString()}</span>
            )}
          </p>
        )}
        {status === "error" && errorReason && (
          <p className="text-xs text-red-400 font-mono mt-1">{errorReason}</p>
        )}
      </div>

      <div className="shrink-0 flex flex-col items-end gap-2">
        {/* Status badge */}
        <div className="flex items-center gap-2">
          {status === "loading" && (
            <span className="text-xs text-slate-500">Checking…</span>
          )}
          {status === "connected" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/[0.12] border border-emerald-500/[0.25] text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              Connected
            </span>
          )}
          {(status === "not_connected" || status === "error") && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-white/[0.05] border border-white/[0.1] text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600 inline-block" />
              Not connected
            </span>
          )}
        </div>

        {/* Action buttons */}
        {status === "connected" ? (
          <div className="flex items-center gap-3">
            <a
              href="/api/auth/google"
              className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              Reconnect
            </a>
            <button
              onClick={disconnect}
              disabled={disconnecting}
              className="text-[10px] text-red-500/80 hover:text-red-400 transition-colors disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        ) : status !== "loading" ? (
          <a
            href="/api/auth/google"
            className="px-3 py-1.5 rounded-lg bg-slate-700/80 border border-slate-600/50 text-xs text-slate-100 font-semibold hover:bg-slate-600/80 transition-colors shadow-sm"
          >
            Connect Google Drive
          </a>
        ) : null}
      </div>
    </div>
  );
}
