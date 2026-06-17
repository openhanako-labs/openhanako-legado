// _lib/credentials.js
// 凭据管理：服务地址 + accessToken 加密存储到 ${dataDir}/legado-companion/credentials.json
// 加密：PBKDF2 派生密钥 + AES-256-GCM（完全复用 weread-companion 的加密逻辑）
//
// 读取优先级：
//   1) 环境变量 LEGADO_SERVICE_URL
//   2) 本地加密存储
//
// 写入：永远不写明文；永远不在日志中输出敏感信息

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const PBKDF2_ITERS = 600000;
const SALT_FILE = "salt.bin";
const CREDS_FILE = "credentials.json";

function deviceFingerprint() {
  const parts = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.userInfo().username || "",
  ];
  return parts.join("|");
}

function kdf(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERS, 32, "sha256");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * 读凭据。返回 { source, serviceUrl, accessToken }。
 * source ∈ {"env", "local-encrypted", "decrypt_failed", null}。
 */
export function readCredentials(dataDir) {
  // 1) 环境变量（最优先）
  const envUrl = process.env.LEGADO_SERVICE_URL;
  if (envUrl && envUrl.trim()) {
    return {
      source: "env",
      serviceUrl: envUrl.trim(),
      accessToken: process.env.LEGADO_ACCESS_TOKEN || null,
    };
  }

  // 2) 本地加密存储
  if (dataDir) {
    const dir = path.join(dataDir, "legado-companion");
    const saltPath = path.join(dir, SALT_FILE);
    const credsPath = path.join(dir, CREDS_FILE);
    if (fs.existsSync(saltPath) && fs.existsSync(credsPath)) {
      try {
        const salt = fs.readFileSync(saltPath);
        const creds = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
        const key = kdf(deviceFingerprint(), salt);
        const iv = Buffer.from(creds.iv, "base64");
        const tag = Buffer.from(creds.tag, "base64");
        const data = Buffer.from(creds.data, "base64");
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
        // JSON 格式：{"serviceUrl":"http://...","accessToken":"..."}
        const parsed = JSON.parse(plain);
        if (parsed && parsed.serviceUrl) {
          return { source: "local-encrypted", serviceUrl: parsed.serviceUrl, accessToken: parsed.accessToken || null };
        }
      } catch (err) {
        return { source: "decrypt_failed", serviceUrl: null, accessToken: null, reason: err?.message || "decrypt_failed" };
      }
    }
  }

  return { source: null, serviceUrl: null, accessToken: null };
}

/**
 * 写凭据到本地加密存储。
 * @param {string} serviceUrl - 服务地址，如 http://192.168.1.84:1122
 * @param {string} [accessToken] - 可选的 accessToken（服务器版需要）
 */
export function writeCredentials(dataDir, serviceUrl, accessToken) {
  if (!serviceUrl || typeof serviceUrl !== "string") {
    throw new Error("服务地址不能为空");
  }
  if (!dataDir) throw new Error("writeCredentials 需要 dataDir");

  const dir = path.join(dataDir, "legado-companion");
  ensureDir(dir);
  const saltPath = path.join(dir, SALT_FILE);
  const credsPath = path.join(dir, CREDS_FILE);

  let salt;
  if (fs.existsSync(saltPath)) {
    salt = fs.readFileSync(saltPath);
  } else {
    salt = crypto.randomBytes(16);
    fs.writeFileSync(saltPath, salt);
  }
  const key = kdf(deviceFingerprint(), salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = JSON.stringify({
    serviceUrl,
    accessToken: accessToken || "",
  });
  const enc = Buffer.concat([cipher.update(data, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  fs.writeFileSync(
    credsPath,
    JSON.stringify({
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      data: enc.toString("base64"),
      updatedAt: new Date().toISOString(),
    }, null, 2)
  );
}

/**
 * 抹除本地凭据。
 */
export function clearCredentials(dataDir) {
  let cleared = [];
  let source = null;
  const before = readCredentials(dataDir);
  source = before.source;

  if (dataDir) {
    const credsPath = path.join(dataDir, "legado-companion", CREDS_FILE);
    if (fs.existsSync(credsPath)) { fs.unlinkSync(credsPath); cleared.push("plugin-creds"); }
    const saltPath = path.join(dataDir, "legado-companion", SALT_FILE);
    if (fs.existsSync(saltPath)) { fs.unlinkSync(saltPath); cleared.push("plugin-salt"); }
  }

  // 清环境变量引用（无法真正删，但清掉进程内缓存标记）
  delete process.env.LEGADO_SERVICE_URL;
  delete process.env.LEGADO_ACCESS_TOKEN;

  const after = readCredentials(dataDir);
  return { cleared, source, still_has: Boolean(after && after.serviceUrl) };
}

/**
 * 红化：日志里打地址时隐藏敏感部分
 */
export function redactUrl(url) {
  if (!url) return "[REDACTED]";
  try {
    const u = new URL(url);
    return `[REDACTED]...${u.host.slice(-8)}`;
  } catch {
    return "[REDACTED]";
  }
}
