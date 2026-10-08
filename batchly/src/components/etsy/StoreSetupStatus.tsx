interface Props {
  etsyShopName: string | null;
  taxonomyId: string | null;
  shippingProfileId: string | null;
  readinessStateId: string | null;
  miniBatchEnabled: boolean;
}

function Row({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-[9px] font-bold w-3 text-center ${ok ? "text-emerald-400" : "text-red-400"}`}>
        {ok ? "✓" : "✗"}
      </span>
      <span className="text-[10px] text-zinc-400">{label}</span>
      {detail && (
        <span className="ml-auto text-[9px] font-mono text-zinc-500 truncate max-w-[100px]" title={detail}>
          {detail}
        </span>
      )}
    </div>
  );
}

export function StoreSetupStatus({
  etsyShopName,
  taxonomyId,
  shippingProfileId,
  readinessStateId,
  miniBatchEnabled,
}: Props) {
  const allIdsPresent = !!(taxonomyId && shippingProfileId && readinessStateId);
  const readyForCreation = allIdsPresent && miniBatchEnabled && !!etsyShopName;

  const missing: string[] = [];
  if (!etsyShopName) missing.push("Etsy shop not connected");
  if (!taxonomyId) missing.push("taxonomyId not saved");
  if (!shippingProfileId) missing.push("shippingProfileId not saved");
  if (!readinessStateId) missing.push("readinessStateId not saved");
  if (!miniBatchEnabled) missing.push("mini-batch not enabled");

  return (
    <div className="mt-2 rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2 space-y-1">
      <p className="text-[9px] text-zinc-500 font-semibold uppercase tracking-wide mb-1">
        Store Setup Status
      </p>

      <Row
        label="Etsy shop"
        ok={!!etsyShopName}
        detail={etsyShopName ?? undefined}
      />
      <Row label="taxonomyId" ok={!!taxonomyId} detail={taxonomyId} />
      <Row label="shippingProfileId" ok={!!shippingProfileId} detail={shippingProfileId} />
      <Row label="readinessStateId" ok={!!readinessStateId} detail={readinessStateId} />
      <Row label="Mini-batch enabled" ok={miniBatchEnabled} />

      {/* Dry Run Readiness */}
      <div className={`mt-1.5 pt-1.5 border-t border-zinc-800`}>
        <div className="flex items-center gap-1.5">
          <span className={`text-[9px] font-bold w-3 text-center ${readyForCreation ? "text-emerald-400" : "text-yellow-400"}`}>
            {readyForCreation ? "✓" : "!"}
          </span>
          <span className={`text-[10px] font-semibold ${readyForCreation ? "text-emerald-400" : "text-yellow-400"}`}>
            {readyForCreation ? "Ready for dry run" : "Not ready for dry run"}
          </span>
        </div>
        {!readyForCreation && missing.length > 0 && (
          <ul className="mt-1 ml-4 space-y-0.5">
            {missing.map((item) => (
              <li key={item} className="text-[9px] text-yellow-500">
                · {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
