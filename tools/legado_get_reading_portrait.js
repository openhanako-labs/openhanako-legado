// tools/legado_get_reading_portrait.js
// AI 阅读画像——基于书架数据生成用户阅读画像。
// LLM 通过宿主能力自动调用，用户无需配置模型。
// 支持文件缓存（forceRefresh=false 时返回缓存的画像）。

import fs from "node:fs";
import path from "node:path";
import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf } from "./_lib/legado-api.js";
import { buildBookshelfPrompt, parsePortraitResponse } from "./_lib/portrait.js";
import { chatCompletion } from "./_lib/llm.js";

const CACHE_FILE = "portrait-cache.json";

function loadCache(dataDir) {
  try {
    const fp = path.join(dataDir, "legado-companion", CACHE_FILE);
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {}
  return null;
}

function saveCache(dataDir, data) {
  try {
    const dir = path.join(dataDir, "legado-companion");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, CACHE_FILE), JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}

export default async function legado_get_reading_portrait(
  { forceRefresh = false } = {},
  ctx = {}
) {
  const { dataDir, bus } = ctx;
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  // 非强制刷新：返回缓存
  if (!forceRefresh) {
    const cached = loadCache(dataDir);
    if (cached) {
      return { ...cached, _cached: true, _cachedAt: cached._generatedAt || "" };
    }
  }

  try {
    const books = await getBookshelf(serviceUrl, "0", 100);

    if (!bus?.request) {
      return {
        ok: true,
        portrait: null,
        data: {
          booksCount: books.length,
          hint: "LLM 不可用，已返回原始数据摘要",
          sample: books.slice(0, 5).map(b => ({
            title: b.name,
            author: b.author,
            kind: b.kind,
            progress: b.durChapterTitle || "未开始",
          })),
        },
      };
    }

    const prompt = buildBookshelfPrompt(books, "生成一份详细的阅读画像，分析阅读偏好、题材偏好、阅读节奏等。");
    const llmResult = await chatCompletion(ctx, {
      operation: "legado-companion-portrait",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      maxTokens: 1500,
    });

    if (llmResult.ok) {
      const parsed = parsePortraitResponse(llmResult.text);
      const result = {
        ok: true,
        portrait: parsed || { raw: llmResult.text },
        data: { booksCount: books.length, via: llmResult.via },
        _generatedAt: new Date().toLocaleString("zh-CN"),
      };
      // 缓存结果
      saveCache(dataDir, result);
      return result;
    }

    return {
      ok: true,
      portrait: null,
      data: {
        booksCount: books.length,
        code: llmResult.code,
        hint: llmResult.hint || llmResult.message || "LLM 暂不可用",
        sample: books.slice(0, 5).map(b => ({
          title: b.name,
          author: b.author,
          kind: b.kind,
        })),
      },
    };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}