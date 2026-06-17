// routes/ui.js
// 阅读伴脑 UI 路由——复用 weread-companion 的前端（panel.js / panel.css），
// 后端适配 Legado 数据结构，API 端点格式完全对齐 weread-companion。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readCredentials, writeCredentials, clearCredentials } from "../tools/_lib/credentials.js";
import { ping as legadoPing, getBookshelf, getBookInfo, getBookChapters, getChapterContent, getBookNotes, searchBooks, getBookProgress, callLegadoApi } from "../tools/_lib/legado-api.js";
import legadoGetPortrait from "../tools/legado_get_reading_portrait.js";
import legadoAskNotes from "../tools/legado_ask_notes.js";

// ---- 读服务器 token ----

function getServerToken() {
  try {
    const si = path.join(os.homedir(), ".hanako", "server-info.json");
    if (fs.existsSync(si)) {
      const d = JSON.parse(fs.readFileSync(si, "utf-8"));
      return d?.token || "";
    }
  } catch {}
  return "";
}

// ---- 路由注册 ----

export default function registerLegadoRoutes(app, ctx) {
  const pid = ctx.pluginId;
  const dd = ctx.dataDir;

  // ---- invokeTool helper ----
  async function invokeTool(tool, input) {
    try {
      const result = await tool.execute ? tool.execute(input, ctx) : tool(input, ctx);
      return result;
    } catch (err) {
      ctx.log?.error?.("tool error", err.message);
      return { ok: false, code: "tool_error", message: err.message };
    }
  }

  // ---- iframe shell ----

  app.get("/page", (c) => c.html(renderShell(c, ctx, "page")));
  app.get("/widget", (c) => c.html(renderShell(c, ctx, "widget")));
  app.get("/assets/*", (c) => serveAsset(c, ctx));

  // ---- 登录状态（对齐 weread login-status）----

  app.get("/api/login-status", async (c) => {
    const creds = readCredentials(dd);
    if (!creds.serviceUrl) {
      return c.json({ ok: true, logged: false, code: "no_service", hint: "未配置服务地址" });
    }
    try {
      const books = await legadoPing(creds.serviceUrl);
      return c.json({ ok: true, logged: true, code: "connected", serviceUrl: creds.serviceUrl, bookCount: books.length });
    } catch (err) {
      return c.json({ ok: true, logged: false, code: err.code || "error", message: err.message });
    }
  });

  // ---- 用户信息（对齐 weread user-info）----

  app.get("/api/user-info", (c) => {
    const creds = readCredentials(dd);
    return c.json({
      ok: true,
      logged: Boolean(creds.serviceUrl),
      serviceUrl: creds.serviceUrl || "",
      name: "Legado 用户",
    });
  });

  // ---- 书架（对齐 weread shelf）----

  app.get("/api/shelf", async (c) => {
    const creds = readCredentials(dd);
    if (!creds.serviceUrl) return c.json({ ok: true, logged: false, books: [], totalCount: 0 });
    try {
      const rawBooks = await getBookshelf(creds.serviceUrl, "0", 200);
      // 映射为 weread 格式
      const books = rawBooks.map(b => ({
        bookId: b.bookUrl,
        title: b.name || "未知",
        author: b.author || "",
        cover: b.customCoverUrl || b.coverUrl || "",
        intro: b.intro || "",
        wordCount: b.wordCount || "",
        latestChapterTitle: b.latestChapterTitle || "",
        durChapterTitle: b.durChapterTitle || "",
        durChapterIndex: b.durChapterIndex ?? -1,
        durChapterPos: b.durChapterPos ?? 0,
        durChapterTime: b.durChapterTime || 0,
        totalChapterNum: b.totalChapterNum ?? 0,
        kind: b.kind || "",
        origin: b.origin || "",
        originName: b.originName || "",
        group: b.group ?? 0,
        bookUrl: b.bookUrl,
      }));
      return c.json({ ok: true, logged: true, books, totalCount: books.length });
    } catch (err) {
      return c.json({ ok: false, code: err.code, message: err.message });
    }
  });

  // ---- 书籍信息（对齐 weread book-info）----

  app.get("/api/book-info", async (c) => {
    const bookId = c.req.query("bookId") || "";
    if (!bookId) return c.json({ ok: false, code: "missing_bookId" }, 400);
    const creds = readCredentials(dd);
    if (!creds.serviceUrl) return c.json({ ok: false, code: "no_service" });
    try {
      const info = await getBookInfo(creds.serviceUrl, bookId);
      return c.json({ ok: true, ...info });
    } catch (err) {
      return c.json({ ok: false, code: err.code, message: err.message });
    }
  });

  // ---- 阅读进度（对齐 weread book-progress）----

  app.get("/api/book-progress", async (c) => {
    const bookId = c.req.query("bookId") || "";
    if (!bookId) return c.json({ ok: false, code: "missing_bookId" }, 400);
    const creds = readCredentials(dd);
    if (!creds.serviceUrl) return c.json({ ok: false, code: "no_service" });
    try {
      const progress = await getBookProgress(creds.serviceUrl, bookId);
      return c.json({ ok: true, ...progress });
    } catch (err) {
      return c.json({ ok: false, code: err.code, message: err.message });
    }
  });

  // ---- 章节列表（对齐 weread book-chapters）----

  app.get("/api/book-chapters", async (c) => {
    const bookId = c.req.query("bookId") || "";
    if (!bookId) return c.json({ ok: false, code: "missing_bookId" }, 400);
    const creds = readCredentials(dd);
    if (!creds.serviceUrl) return c.json({ ok: false, code: "no_service" });
    try {
      const chapters = await getBookChapters(creds.serviceUrl, bookId);
      return c.json({ ok: true, chapters, totalCount: Array.isArray(chapters) ? chapters.length : 0 });
    } catch (err) {
      return c.json({ ok: false, code: err.code, message: err.message });
    }
  });

  // ---- 笔记/划线（对齐 weread book-notes）----

  app.get("/api/book-notes", async (c) => {
    const bookId = c.req.query("bookId") || "";
    const creds = readCredentials(dd);
    if (!creds.serviceUrl) return c.json({ ok: true, notes: [], totalCount: 0 });
    try {
      if (bookId) {
        const notes = await getBookNotes(creds.serviceUrl, bookId);
        return c.json({ ok: true, notes, totalCount: notes.length });
      }
      // 无 bookId 时返回所有书的进度信息作为笔记
      const books = await getBookshelf(creds.serviceUrl, "0", 100);
      const notes = books.filter(b => b.durChapterTitle).map(b => ({
        bookId: b.bookUrl,
        bookTitle: b.name,
        content: `读到: ${b.durChapterTitle}`,
        text: b.durChapterTitle,
        timestamp: b.durChapterTime || 0,
      }));
      return c.json({ ok: true, notes, totalCount: notes.length });
    } catch (err) {
      return c.json({ ok: false, code: err.code, message: err.message });
    }
  });

  // ---- 书评（对齐 weread book-reviews，Legado 无此功能）----

  app.get("/api/book-reviews", (c) => {
    return c.json({ ok: true, reviews: [], totalCount: 0 });
  });

  // ---- 搜索笔记（对齐 weread search-notes）----

  app.get("/api/search-notes", async (c) => {
    const q = (c.req.query("q") || "").trim();
    const limit = Number(c.req.query("limit") || 20);
    if (!q) return c.json({ ok: false, code: "missing_query" }, 400);
    const creds = readCredentials(dd);
    if (!creds.serviceUrl) return c.json({ ok: true, results: [], total: 0 });
    try {
      const books = await getBookshelf(creds.serviceUrl, "0", 100);
      const lower = q.toLowerCase();
      const results = books.filter(b => {
        return (b.name || "").toLowerCase().includes(lower)
          || (b.author || "").toLowerCase().includes(lower)
          || (b.intro || "").toLowerCase().includes(lower)
          || (b.durChapterTitle || "").toLowerCase().includes(lower);
      }).slice(0, limit).map(b => ({
        bookId: b.bookUrl,
        bookTitle: b.name,
        content: b.intro ? b.intro.slice(0, 200) : "",
        text: b.durChapterTitle || "",
        timestamp: b.durChapterTime || 0,
      }));
      return c.json({ ok: true, results, total: results.length });
    } catch (err) {
      return c.json({ ok: false, code: err.code, message: err.message });
    }
  });

  // ---- 搜索书籍（对齐 weread search-books）----

  app.get("/api/search-books", async (c) => {
    const q = (c.req.query("q") || "").trim();
    const limit = Number(c.req.query("limit") || 20);
    if (!q) return c.json({ ok: false, code: "missing_query" }, 400);
    const creds = readCredentials(dd);
    if (!creds.serviceUrl) return c.json({ ok: true, books: [], totalCount: 0 });
    try {
      const rawBooks = await searchBooks(creds.serviceUrl, q, limit);
      const books = rawBooks.map(b => ({
        bookId: b.bookUrl || b.name,
        title: b.name || b.title || "未知",
        author: b.author || "",
        cover: b.coverUrl || "",
        intro: b.intro || "",
        wordCount: b.wordCount || "",
      }));
      return c.json({ ok: true, books, totalCount: books.length });
    } catch (err) {
      return c.json({ ok: false, code: err.code, message: err.message });
    }
  });

  // ---- 搜索书城（对齐 weread search-bookstore）----

  app.get("/api/search-bookstore", async (c) => {
    const keyword = (c.req.query("keyword") || "").trim();
    const count = Number(c.req.query("count") || 20);
    if (!keyword) return c.json({ ok: false, code: "missing_keyword" }, 400);
    const creds = readCredentials(dd);
    if (!creds.serviceUrl) return c.json({ ok: true, books: [], totalCount: 0 });
    try {
      const rawBooks = await searchBooks(creds.serviceUrl, keyword, count);
      const books = rawBooks.map(b => ({
        bookId: b.bookUrl || b.name,
        title: b.name || b.title || "未知",
        author: b.author || "",
        cover: b.coverUrl || "",
        intro: b.intro || "",
      }));
      return c.json({ ok: true, books, totalCount: books.length });
    } catch (err) {
      return c.json({ ok: false, code: err.code, message: err.message });
    }
  });

  // ---- 阅读统计（对齐 weread reading-stats）----

  app.get("/api/reading-stats", async (c) => {
    const creds = readCredentials(dd);
    if (!creds.serviceUrl) return c.json({ ok: true, stats: {} });
    try {
      const books = await getBookshelf(creds.serviceUrl, "0", 200);
      const totalBooks = books.length;
      const readBooks = books.filter(b => (b.durChapterIndex ?? -1) >= 0).length;
      const inProgress = books.filter(b => b.durChapterTitle && b.durChapterTitle.length > 0).length;
      const finished = books.filter(b => (b.wordCount || "").includes("完结") || (b.kind || "").includes("完结")).length;
      const localBooks = books.filter(b => b.origin === "loc_book").length;
      const onlineBooks = totalBooks - localBooks;
      // 分组分布
      const groups = {};
      for (const b of books) {
        const g = String(b.group ?? 0);
        groups[g] = (groups[g] || 0) + 1;
      }
      const groupsList = Object.entries(groups)
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => ({ id: Number(id), count }));
      return c.json({
        ok: true,
        stats: { totalBooks, readBooks, inProgress, finished, localBooks, onlineBooks, groups: groupsList },
      });
    } catch (err) {
      return c.json({ ok: false, code: err.code, message: err.message });
    }
  });

  // ---- 阅读画像（对齐 weread portrait）----

  app.get("/api/portrait", async (c) => {
    const force = c.req.query("force") === "1";
    const out = await invokeTool(legadoGetPortrait, { forceRefresh: force });
    return c.json(out);
  });

  app.post("/api/portrait/regenerate", async (c) => {
    const out = await invokeTool(legadoGetPortrait, { forceRefresh: true });
    return c.json(out);
  });

  // ---- 时间线（对齐 weread timeline）----

  app.get("/api/timeline", async (c) => {
    const creds = readCredentials(dd);
    if (!creds.serviceUrl) return c.json({ ok: true, events: [] });
    try {
      const books = await getBookshelf(creds.serviceUrl, "0", 100);
      const events = books
        .filter(b => b.durChapterTime)
        .sort((a, b) => b.durChapterTime - a.durChapterTime)
        .slice(0, 30)
        .map(b => ({
          type: "read",
          timestamp: b.durChapterTime,
          bookTitle: b.name,
          chapterTitle: b.durChapterTitle || "",
          author: b.author || "",
        }));
      return c.json({ ok: true, events });
    } catch (err) {
      return c.json({ ok: false, code: err.code, message: err.message });
    }
  });

  // ---- 同步时间（对齐 weread synced-at）----

  app.get("/api/synced-at", (c) => {
    return c.json({ ok: true, syncedAt: Date.now(), source: "legado" });
  });

  // ---- 缓存诊断（对齐 weread cache-diag）----

  app.get("/api/cache-diag", (c) => {
    return c.json({ ok: true, message: "Legado 无本地缓存" });
  });

  // ---- 章节内容 ----

  app.get("/api/chapter-content", async (c) => {
    const bookId = (c.req.query("bookId") || "").trim();
    const index = Number(c.req.query("index") ?? 0);
    if (!bookId) return c.json({ ok: false, code: "missing_bookId" }, 400);
    const creds = readCredentials(dd);
    if (!creds.serviceUrl) return c.json({ ok: false, code: "no_service", message: "未配置服务地址" });
    try {
      const data = await getChapterContent(creds.serviceUrl, bookId, index);
      const body = data?.body || data?.text || data?.content || data || "";
      return c.json({ ok: true, content: typeof body === "string" ? body : JSON.stringify(body) });
    } catch (err) {
      return c.json({ ok: false, code: err.code, message: err.message });
    }
  });

  // ---- 灵感拾取（对齐 weread inspire-pick）----

  app.get("/api/inspire-pick", async (c) => {
    const creds = readCredentials(dd);
    if (!creds.serviceUrl) return c.json({ ok: true, picks: [] });
    try {
      const books = await getBookshelf(creds.serviceUrl, "0", 100);
      const picks = books
        .filter(b => b.intro && b.intro.length > 20)
        .sort(() => Math.random() - 0.5)
        .slice(0, 3)
        .map(b => ({
          bookTitle: b.name,
          author: b.author || "",
          excerpt: b.intro.slice(0, 150),
          kind: b.kind || "",
        }));
      return c.json({ ok: true, picks });
    } catch (err) {
      return c.json({ ok: false, code: err.code, message: err.message });
    }
  });

  // ---- LLM 对话（对齐 weread llm/chat）----

  app.post("/api/llm/chat", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const query = (body.messages || []).map(m => m.content || "").filter(Boolean).join("\n");
    if (!query) return c.json({ ok: false, code: "missing_query", message: "请提供问题" }, 400);
    const out = await invokeTool(legadoAskNotes, { query, bookUrl: body.bookUrl || null });
    return c.json(out);
  });

  // ---- 分组名持久化 ----
  app.get("/api/group-names", (c) => {
    try {
      const fp = path.join(dd, "legado-companion", "group-names.json");
      if (fs.existsSync(fp)) return c.json({ ok: true, names: JSON.parse(fs.readFileSync(fp, "utf-8")) });
    } catch {}
    return c.json({ ok: true, names: {} });
  });

  app.post("/api/group-names", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const names = body.names || {};
      const dir = path.join(dd, "legado-companion");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "group-names.json"), JSON.stringify(names, null, 2));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, message: err.message }, 500);
    }
  });

  app.post("/api/credentials", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const url = body.serviceUrl || body.apiKey || "";
      if (!url) return c.json({ ok: false, code: "bad_format", hint: "请提供服务地址" }, 400);
      const final = url.startsWith("http") ? url : "http://" + url;
      writeCredentials(dd, final);
      ctx.log?.info?.("credentials updated", { serviceUrl: final });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, code: "write_failed", message: err.message }, 500);
    }
  });

  app.get("/api/credentials", async (c) => {
    const method = c.req.query("method") || "get";
    const url = c.req.query("url") || "";
    if (method === "clear") {
      clearCredentials(dd);
      return c.json({ ok: true });
    }
    if (method === "POST" && url) {
      if (!url) return c.json({ ok: false, code: "bad_format", hint: "url 为空" }, 400);
      const final = url.startsWith("http") ? url : "http://" + url;
      writeCredentials(dd, final);
      return c.json({ ok: true });
    }
    const creds = readCredentials(dd);
    return c.json({ ok: true, hasService: Boolean(creds.serviceUrl), serviceUrl: creds.serviceUrl || "" });
  });

  // ---- 代理图片（对齐 weread proxy-image）----

  app.get("/api/proxy-image", async (c) => {
    const url = c.req.query("url") || "";
    if (!/^https?:\/\//i.test(url)) return c.json({ ok: false, code: "bad_url" }, 400);
    try {
      const resp = await fetch(url);
      if (!resp.ok) return c.json({ ok: false, code: "upstream" }, 502);
      const buf = Buffer.from(await resp.arrayBuffer());
      const ct = resp.headers.get("content-type") || "image/jpeg";
      return new Response(buf, { headers: { "Content-Type": ct, "Cache-Control": "public, max-age=86400" } });
    } catch (err) {
      return c.json({ ok: false, code: "proxy_failed", message: err.message }, 500);
    }
  });

  // ---- 保存卡片（对齐 weread save-card）----

  app.post("/api/save-card", async (c) => {
    return c.json({ ok: false, code: "not_implemented" }, 501);
  });
}

// ---- iframe shell ----

function renderShell(c, ctx, surface) {
  const base = `/api/plugins/${ctx.pluginId}`;
  const urlToken = c.req.query("token") || "";

  let cssInline = "";
  try {
    const cssPath = path.join(ctx.pluginDir, "assets", "panel.css");
    if (fs.existsSync(cssPath)) cssInline = fs.readFileSync(cssPath, "utf-8");
  } catch {}

  let jsInline = "";
  try {
    const jsPath = path.join(ctx.pluginDir, "assets", "panel.js");
    if (fs.existsSync(jsPath)) jsInline = fs.readFileSync(jsPath, "utf-8");
  } catch {}

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>阅读·伴脑</title>
  <style>${cssInline}</style>
</head>
<body data-surface="${surface}">
  <div id="root" data-surface="${surface}"></div>
  <script>window.HANA_TOKEN=${JSON.stringify(urlToken)};window.HANA_PLUGIN_BASE=${JSON.stringify(base)};</script>
  <script>${jsInline}</script>
</body>
</html>`;
}

function serveAsset(c, ctx) {
  const rawName = c.req.path.split("/assets/")[1] || "";
  const fileName = path.basename(decodeURIComponent(rawName));
  if (!fileName) return c.text("Not found", 404);
  const assetsDir = path.join(ctx.pluginDir, "assets");
  const filePath = path.join(assetsDir, fileName);
  if (!filePath.startsWith(assetsDir + path.sep) || !fs.existsSync(filePath)) {
    return c.text("Not found", 404);
  }
  const ext = fileName.split(".").pop().toLowerCase();
  const types = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg" };
  c.header("Content-Type", types[ext] || "application/octet-stream");
  c.header("Cache-Control", "no-cache");
  return c.body(fs.readFileSync(filePath));
}
