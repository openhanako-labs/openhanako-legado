// tools/legado_rss_intake.js
// RSS 新书资讯联动 — 从 RSS 订阅源提取新书信息，供推荐系统使用。
// 自包含 RSS 拉取，不依赖 Hanako RSS 插件。

import fs from "node:fs";
import path from "node:path";
import { readCredentials } from "./_lib/credentials.js";

const INTAKE_FILE = "rss-intake.json";
const DEFAULT_FEEDS = [];

/**
 * RSS 书讯摄取。
 * @param {object} input
 * @param {"fetch"|"list"|"config"} [input.action="fetch"]
 *    fetch: 拉取所有订阅源，提取新书线索
 *    list: 查看已提取的线索
 *    config: 配置 RSS 订阅源
 * @param {string[]} [input.feeds] — config 模式时设置新的 RSS 源 URL 列表
 * @param {number} [input.limit=20] — list 模式返回条数
 */
export default async function legado_rss_intake(
  { action = "fetch", feeds = null, limit = 20 } = {},
  { dataDir, log } = {}
) {
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  const intakePath = path.join(dataDir, "legado-companion", INTAKE_FILE);

  // ---- 配置订阅源 ----
  if (action === "config") {
    try {
      const dir = path.dirname(intakePath);
      fs.mkdirSync(dir, { recursive: true });

      let existing = { feeds: [], items: [] };
      if (fs.existsSync(intakePath)) {
        existing = JSON.parse(fs.readFileSync(intakePath, "utf-8"));
      }

      const newFeeds = Array.isArray(feeds) ? feeds : [];
      existing.feeds = newFeeds;
      fs.writeFileSync(intakePath, JSON.stringify(existing, null, 2), "utf-8");

      log?.info?.("rss feeds configured", { count: newFeeds.length });
      return { ok: true, feeds: newFeeds, count: newFeeds.length };
    } catch (err) {
      return { ok: false, code: "write_failed", message: err.message };
    }
  }

  // ---- 查看已提取的线索 ----
  if (action === "list") {
    try {
      if (fs.existsSync(intakePath)) {
        const data = JSON.parse(fs.readFileSync(intakePath, "utf-8"));
        const items = (data.items || []).slice(-limit);
        return {
          ok: true,
          items,
          total: (data.items || []).length,
          feeds: data.feeds || [],
        };
      }
    } catch {}
    return { ok: true, items: [], total: 0, feeds: [] };
  }

  // ---- 拉取订阅源 ----
  try {
    let config = { feeds: [], items: [] };
    if (fs.existsSync(intakePath)) {
      try { config = JSON.parse(fs.readFileSync(intakePath, "utf-8")); } catch {}
    }

    const feedsToFetch = config.feeds.length > 0 ? config.feeds : DEFAULT_FEEDS;
    if (feedsToFetch.length === 0) {
      return {
        ok: true,
        hint: "未配置 RSS 订阅源。请先使用 action=config 添加 RSS 源 URL。",
        items: [],
      };
    }

    const newItems = [];
    for (const feedUrl of feedsToFetch) {
      try {
        const xml = await fetchWithTimeout(feedUrl, 10000);
        const parsed = parseRSS(xml);
        if (parsed.items.length > 0) {
          newItems.push(...parsed.items.map(item => ({
            ...item,
            feedTitle: parsed.title || feedUrl,
            feedUrl,
            ingestedAt: Date.now(),
          })));
        }
      } catch (err) {
        log?.warn?.("rss fetch failed", { feedUrl, error: err.message });
      }
    }

    // 去重（按标题去重）
    const seen = new Set();
    for (const item of (config.items || [])) {
      if (item.title) seen.add(item.title);
    }

    let addedCount = 0;
    for (const item of newItems) {
      if (item.title && !seen.has(item.title)) {
        seen.add(item.title);
        config.items.push(item);
        addedCount++;
      }
    }

    // 限制最大存储 500 条
    if (config.items.length > 500) {
      config.items = config.items.slice(-500);
    }

    // 保存
    const dir = path.dirname(intakePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(intakePath, JSON.stringify(config, null, 2), "utf-8");

    log?.info?.("rss intake completed", {
      feedsFetched: feedsToFetch.length,
      newItems: addedCount,
      totalItems: config.items.length,
    });

    return {
      ok: true,
      feeds: feedsToFetch.length,
      new: addedCount,
      total: config.items.length,
      preview: newItems.slice(0, 5).map(i => ({
        title: i.title,
        source: i.feedTitle,
        date: i.pubDate,
      })),
    };
  } catch (err) {
    return { ok: false, code: "tool_error", message: err.message };
  }
}

// ====== 工具函数 ======

/** 带超时的 fetch */
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LegadoCompanion/1.0)" },
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 极简 RSS/Atom XML 解析（只提取标题+链接+日期，不做完整 XML 解析） */
function parseRSS(xml) {
  const result = { title: "", items: [] };

  // 提取 feed 标题
  const titleMatch = xml.match(/<title[^>]*>([^<]+)<\/title>/);
  if (titleMatch) result.title = titleMatch[1];

  // 按 item 或 entry 分割
  const itemRegex = /<(item|entry)[\s\S]*?<\/(item|entry)>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[0];
    const item = {
      title: extractField(block, "title"),
      link: extractLink(block),
      pubDate: extractField(block, "(?:pubDate|published|updated)"),
      description: stripHTML(extractField(block, "(?:description|summary|content)")).slice(0, 500),
    };
    if (item.title) result.items.push(item);
  }

  return result;
}

function extractField(block, fieldName) {
  const regex = new RegExp(`<${fieldName}[^>]*>([\\s\\S]*?)<\\/${fieldName}>`, "i");
  const m = regex.exec(block);
  return m ? m[1].trim() : "";
}

function extractLink(block) {
  // <link>url</link> 或 <link href="url"/>
  const m1 = /<link[^>]*>([^<]+)<\/link>/.exec(block);
  if (m1) return m1[1].trim();
  const m2 = /<link[^>]*href="([^"]+)"/.exec(block);
  if (m2) return m2[1].trim();
  return "";
}

function stripHTML(text) {
  return text.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
}