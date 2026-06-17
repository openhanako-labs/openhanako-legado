// _lib/cache.js
// 缓存层——复用 weread-companion 的缓存机制。
// 所有工具级缓存共享同一个缓存目录。

import fs from "node:fs";
import path from "node:path";

const CACHE_DIR = "cache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

/**
 * 获取缓存目录路径。
 */
export function getCacheDir(dataDir) {
  return path.join(dataDir, "legado-companion", CACHE_DIR);
}

/**
 * 读缓存，过期返回 null。
 */
export function readCache(dataDir, key) {
  const cacheDir = getCacheDir(dataDir);
  const cachePath = path.join(cacheDir, `${key}.json`);
  if (!fs.existsSync(cachePath)) return null;

  try {
    const content = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (Date.now() - content.timestamp > CACHE_TTL_MS) {
      fs.unlinkSync(cachePath);
      return null;
    }
    return content.data;
  } catch {
    return null;
  }
}

/**
 * 写缓存。
 */
export function writeCache(dataDir, key, data) {
  const cacheDir = getCacheDir(dataDir);
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, `${key}.json`);
  fs.writeFileSync(cachePath, JSON.stringify({
    timestamp: Date.now(),
    data,
  }));
}

/**
 * 删除缓存。
 */
export function deleteCache(dataDir, key) {
  const cachePath = path.join(getCacheDir(dataDir), `${key}.json`);
  if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
}
