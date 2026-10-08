import { Suspense } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { DriveConnectionStatus } from "@/components/drive/DriveConnectionStatus";
import { ProductionWarningsBanner } from "@/components/settings/ProductionWarningsBanner";
import { DrivePendingFolderCard } from "@/components/settings/DrivePendingFolderCard";
import { EtsyStoresSummary } from "@/components/settings/EtsyStoresSummary";
import { SoftCard, SectionTitle } from "@/components/ui/batchly-ui";
import { prisma } from "@/lib/prisma";
import { getBatchlySettingsStatus } from "@/lib/services/settingsStatus";
import { getPendingFolderId } from "@/lib/services/appSettings";

export const dynamic = "force-dynamic";

function SettingRow({
  label, description, value,
}: {
  label: string;
  description: string;
  value?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-white/[0.07] last:border-0">
      <div className="space-y-1 min-w-0">
        <p className="text-[13px] text-slate-200 font-medium">{label}</p>
        <p className="text-[12px] text-slate-500 leading-relaxed">{description}</p>
      </div>
      <div className="shrink-0">
        <input
          readOnly
          disabled
          value={value ?? ""}
          placeholder={value ? undefined : "Not configured"}
          className="w-56 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[12px] font-mono text-slate-400 cursor-not-allowed select-none placeholder:text-slate-600 focus:outline-none"
        />
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SoftCard padding={false}>
      <div className="px-5 py-3.5 border-b border-white/[0.07]">
        <SectionTitle>{title}</SectionTitle>
      </div>
      <div className="px-5 py-4">
        {children}
      </div>
    </SoftCard>
  );
}

export default async function SettingsPage() {
  const [preset, variationPreset, supplementalPreset, status, pendingFolderSetting] = await Promise.all([
    prisma.globalListingPreset.findFirst(),
    prisma.globalVariationPreset.findFirst(),
    prisma.globalSupplementalImagePreset.findFirst(),
    getBatchlySettingsStatus(),
    getPendingFolderId(),
  ]);
  const hubConfigureUrl = `${process.env.INQUEUE_HUB_URL ?? "http://localhost:4000"}/#configure`;

  return (
    <div className="flex flex-col flex-1 bg-[#0f1115]">
      <TopBar title="Settings" subtitle="Drive connection, listing presets, and workspace configuration" />

      <div className="p-6 max-w-3xl space-y-5">

        <ProductionWarningsBanner warnings={status.warnings} />

        {/* Drive */}
        <SectionCard title="Google Drive">
          <Suspense fallback={<p className="py-3 text-[12px] text-slate-400">Checking Drive connection…</p>}>
            <DriveConnectionStatus />
          </Suspense>
          <DrivePendingFolderCard
            initialSetting={pendingFolderSetting}
            initialLastTest={status.drive.pendingFolder.lastTest}
            initialLastScan={status.drive.pendingFolder.lastScan}
            driveConnected={status.drive.connected}
          />
          <SettingRow
            label="OAuth credentials"
            description="Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local. See .env.example for setup instructions."
            value={process.env.GOOGLE_CLIENT_ID ? "Configured" : undefined}
          />
        </SectionCard>

        {/* Etsy stores */}
        <SectionCard title="Etsy Stores">
          <EtsyStoresSummary
            stores={status.etsy.stores}
            duplicateDriveFolders={status.etsy.duplicateDriveFolders}
            missingCredentials={!process.env.ETSY_CLIENT_ID}
          />
        </SectionCard>

        {/* Etsy API */}
        <SectionCard title="Etsy API">
          <SettingRow
            label="Etsy app key (client ID)"
            description="Your Etsy developer app key. Set ETSY_CLIENT_ID in .env.local."
            value={process.env.ETSY_CLIENT_ID ? "Configured" : undefined}
          />
          <SettingRow
            label="Redirect URI"
            description="OAuth callback URL. Must match what you registered in the Etsy Developer Portal."
            value={process.env.ETSY_REDIRECT_URI ?? undefined}
          />
          <SettingRow
            label="API request delay"
            description="Delay between Etsy API calls to stay within the 5 req/sec rate limit."
            value="250 ms"
          />
        </SectionCard>

        {/* Draft presets — managed in the inQueue Hub */}
        <SoftCard padding={false}>
          <div className="px-5 py-3.5 border-b border-white/[0.07]">
            <SectionTitle>Draft Presets</SectionTitle>
            <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
              Listing defaults, variations, and supplemental-image rules applied to every draft across
              all stores. Presets are managed centrally —{" "}
              <a
                href={hubConfigureUrl}
                className="text-blue-400 font-medium underline underline-offset-2 hover:opacity-80"
              >
                edit them in the inQueue Hub ↗
              </a>
              . Current values synced to this service:
            </p>
          </div>
          <div className="px-5 py-1">
            <SettingRow
              label="Listing preset"
              description="Who made / when made / price / quantity applied to each draft."
              value={preset ? `${preset.whoMade} · ${preset.whenMade} · $${preset.defaultPrice} · qty ${preset.defaultQuantity}` : undefined}
            />
            <SettingRow
              label="Variations"
              description="Size/Color variations added to each draft when enabled."
              value={
                variationPreset
                  ? variationPreset.enabled
                    ? `${variationPreset.variation1Name} + ${variationPreset.variation2Name} · qty ${variationPreset.quantityPerVariation}`
                    : "Disabled"
                  : undefined
              }
            />
            <SettingRow
              label="Supplemental images"
              description="Size charts and promo images appended after mockups."
              value={
                supplementalPreset
                  ? supplementalPreset.enabled
                    ? `Size charts ${supplementalPreset.includeSizeCharts ? "on" : "off"} · promo ${supplementalPreset.includePromoImages ? "on" : "off"} · max ${supplementalPreset.maxSupplementalImages}`
                    : "Disabled"
                  : undefined
              }
            />
          </div>
        </SoftCard>

        {/* Workspace paths */}
        <SectionCard title="Workspace">
          <SettingRow
            label="Local workspace path"
            description="Directory where downloaded mockup images are stored on this machine."
            value="./workspace"
          />
          <SettingRow
            label="Downloads folder"
            description="Batch folders downloaded from Drive are stored here."
            value="./workspace/downloads"
          />
          <SettingRow
            label="Supplemental images folder"
            description="Size chart and promo images are read from this directory."
            value="./workspace/supplemental-images"
          />
        </SectionCard>

      </div>
    </div>
  );
}
