"use client";

import { useCallback, useEffect, useState } from "react";
import { detectCapabilities, recommend } from "@/lib/engine/capabilities";
import { cachedModelInfo, deleteModel, type CachedModelInfo } from "@/lib/engine/model-cache";
import { getModel } from "@/lib/engine/models";
import { chooseVariant, type ResourceProfile } from "@/lib/engine/resources";
import type { Capabilities, Recommendation } from "@/lib/engine/types";

const TIER_LABEL: Record<Recommendation["tier"], string> = {
  excellent: "Ready",
  good: "Ready",
  limited: "Works, but slowly",
  unsupported: "Not supported",
};

export function useDevice() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [rec, setRec] = useState<Recommendation | null>(null);
  useEffect(() => {
    detectCapabilities().then((c) => {
      setCaps(c);
      setRec(recommend(c));
    });
  }, []);
  return { caps, rec };
}

export function DeviceStatus({
  caps,
  rec,
  profile,
  refreshKey,
}: {
  caps: Capabilities | null;
  rec: Recommendation | null;
  profile: ResourceProfile;
  refreshKey?: number;
}) {
  const [cache, setCache] = useState<CachedModelInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const model = rec?.modelId ? getModel(rec.modelId) : null;
  const variant = model && caps ? chooseVariant(model.id, caps, profile) : null;

  const refresh = useCallback(() => {
    if (model && variant) cachedModelInfo(model.id, variant).then(setCache);
  }, [model, variant]);
  useEffect(refresh, [refresh, refreshKey]);

  if (!caps || !rec) {
    return <div className="h-[92px] animate-pulse rounded-2xl border border-line bg-surface" />;
  }

  const ok = rec.tier === "excellent" || rec.tier === "good";
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted">Your device</div>
          <div className="mt-1.5 flex items-center gap-2 font-medium">
            <span className={`h-2 w-2 rounded-full ${ok ? "bg-accent" : rec.tier === "limited" ? "bg-warn" : "bg-danger"}`} />
            {TIER_LABEL[rec.tier]} for local transcription
          </div>
          <p className="mt-1 text-muted">
            {rec.engine === "browser-webgpu" ? "Uses your GPU through the browser." : rec.reasons.at(-1)}
          </p>
        </div>
        {model && variant && (
          <div className="shrink-0 text-right">
            <div className="text-xs font-medium uppercase tracking-wider text-muted">{model.name}</div>
            {cache?.downloaded ? (
              <div className="mt-1.5">
                <span className="text-accent">Downloaded ✓</span>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await deleteModel(model.id);
                    setBusy(false);
                    refresh();
                  }}
                  className="ml-3 text-muted underline-offset-2 hover:text-danger hover:underline disabled:opacity-50"
                >
                  Delete ({formatMB(cache.bytes)})
                </button>
              </div>
            ) : (
              <div className="mt-1.5 text-muted">One-time download · {formatMB(variant.downloadMB * 1e6)}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function formatMB(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}
