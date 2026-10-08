import fs from "fs/promises";
import path from "path";

export const ROOT_DIR = process.cwd();
export const STORAGE_DIR = path.join(ROOT_DIR, "storage");
export const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
export const OUTPUTS_DIR = path.join(STORAGE_DIR, "outputs");

export function safeSlug(input = "design") {
  return (
    String(input)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "design"
  );
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureBaseDirs() {
  await ensureDir(UPLOADS_DIR);
  await ensureDir(OUTPUTS_DIR);
}

export function jobPaths(jobId) {
  const base = path.join(OUTPUTS_DIR, jobId);
  return {
    base,
    output: path.join(base, "design.png"),
    metadata: path.join(base, "metadata.json"),
  };
}

export async function ensureJobDir(jobId) {
  const paths = jobPaths(jobId);
  await ensureDir(paths.base);
  return paths;
}

export async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function newJobId(seed = "design") {
  return `${Date.now()}-${safeSlug(seed).slice(0, 35)}`;
}
