# Style references

Drop 3–10 of your **best actual design PNGs** (or JPGs) into this folder and
commit them. When any images are present, Inkly generates through the image
model's edit endpoint with up to 2 randomly-picked references attached, telling
the model to **match their quality bar** — finish, layering, texture richness,
professional polish — while explicitly forbidding it from copying their text,
subject, icons, or layout.

- Empty folder (just this README): plain text-to-image generation, no change.
- Override the folder location with the `STYLE_REFERENCE_DIR` env var.
- References should be finished, retail-grade designs you'd happily sell —
  they set the bar the QA reviewer also grades against.
- If the edit call fails for any reason, generation falls back to plain
  text-to-image with a warning in the logs; a bad reference file can't break
  production.
