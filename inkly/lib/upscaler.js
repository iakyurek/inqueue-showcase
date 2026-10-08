import sharp from "sharp";

/**
 * Upscale a transparent PNG buffer toward a target long edge.
 *
 * Order of preference:
 *   1. A super-resolution model (Real-ESRGAN via Replicate) when configured —
 *      this is the only thing that adds genuine detail to low-res sources.
 *   2. High-quality Lanczos-3 resampling via sharp (libvips) as the fallback —
 *      far sharper than browser canvas scaling, but interpolation only.
 *
 * Returns { buffer, method }.
 */
export async function upscale(buffer, options = {}) {
  const target = Number(
    options.targetLongEdge || process.env.UPSCALE_TARGET_LONG_EDGE || 4200
  );
  const meta = await sharp(buffer).metadata();
  const long = Math.max(meta.width || 1, meta.height || 1);

  if (long >= target) {
    return { buffer, method: "none" };
  }

  if (process.env.UPSCALE_PROVIDER === "replicate" && process.env.REPLICATE_API_TOKEN) {
    try {
      const sr = await realEsrgan(buffer, long, target);
      // model returns a fixed 2x/4x; finish the exact sizing with Lanczos
      const fitted = await sharp(sr)
        .resize({ width: target, height: target, fit: "inside", kernel: "lanczos3", withoutEnlargement: false })
        .png()
        .toBuffer();
      return { buffer: fitted, method: "real-esrgan" };
    } catch (err) {
      console.warn("[upscaler] SR provider failed, falling back to Lanczos:", err.message);
    }
  }

  const scale = target / long;
  const fallback = await sharp(buffer)
    .resize(Math.round((meta.width || 1) * scale), Math.round((meta.height || 1) * scale), {
      kernel: "lanczos3",
    })
    .sharpen({ sigma: 0.8 })
    .png()
    .toBuffer();
  return { buffer: fallback, method: "lanczos3" };
}

async function realEsrgan(buffer, long, target) {
  const token = process.env.REPLICATE_API_TOKEN;
  const model = process.env.UPSCALE_MODEL || "nightmareai/real-esrgan";
  const scale = target / long > 2 ? 4 : 2;
  const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;

  const create = await fetch(
    `https://api.replicate.com/v1/models/${model}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({ input: { image: dataUrl, scale, face_enhance: false } }),
    }
  );
  if (!create.ok) throw new Error(`replicate ${create.status}`);

  let pred = await create.json();
  let guard = 0;
  while (
    pred.status &&
    !["succeeded", "failed", "canceled"].includes(pred.status) &&
    pred?.urls?.get &&
    guard++ < 80
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${token}` } });
    pred = await poll.json();
  }
  if (pred.status !== "succeeded") throw new Error(`prediction ${pred.status}`);

  const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!outUrl) throw new Error("no output url");
  const img = await fetch(outUrl);
  return Buffer.from(await img.arrayBuffer());
}
