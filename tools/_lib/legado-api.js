// _lib/legado-api.js
// 开源阅读（Legado）APP 自带 Web 服务 HTTP 网关层。
// 适配真实 API 端点（基于对 zsakvo 前端 + 实测数据反推）
//
// 实测端点：
//   GET /getBookshelf?count=N&type=0/1     → 书架列表
//   GET /getBookInfo?id=<bookUrl>          → 书籍详情
//   GET /getChapterList?url=<bookUrl>      → 章节列表
//   GET /getBookContent?url=<bookUrl>&index=N → 章节内容
//   GET /searchBook?keyword=X&count=N      → 搜索
//
// 通用响应格式：{ "isSuccess": true, "errorMsg": "", "data": {...} }

const DEFAULT_TIMEOUT_MS = 15000;

/** 错误分类 */
export class AuthError extends Error {
  constructor(m) { super(m); this.name = "AuthError"; this.code = "auth"; }
}
export class TimeoutError extends Error {
  constructor(m) { super(m); this.name = "TimeoutError"; this.code = "timeout"; }
}
export class ConnectionError extends Error {
  constructor(m) { super(m); this.name = "ConnectionError"; this.code = "connection"; }
}
export class ShapeError extends Error {
  constructor(m) { super(m); this.name = "ShapeError"; this.code = "shape"; }
}

/**
 * 解析 Legado 统一响应格式。
 * { "isSuccess": true, "errorMsg": "", "data": {...} }
 */
function parseResponse(apiName, rawData) {
  // 如果本身就是 JS 对象（已 parse 的 JSON）
  if (rawData && typeof rawData === "object" && "isSuccess" in rawData) {
    if (!rawData.isSuccess && rawData.errorMsg) {
      throw new ConnectionError(`[${apiName}] ${rawData.errorMsg}`);
    }
    return rawData.data !== undefined ? rawData.data : rawData;
  }
  // 如果返回的是数组或其他结构（部分端点可能直接返回）
  return rawData;
}

/**
 * 构建查询参数字符串。
 */
function buildQuery(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/**
 * 调用 Legado Web 服务 API。
 * @param {string} serviceUrl - 服务地址，如 http://192.168.1.84:1122
 * @param {string} endpoint - API 端点，如 getBookshelf
 * @param {object} [params] - 查询参数
 * @param {number} [timeoutMs]
 */
export async function callLegadoApi(serviceUrl, endpoint, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!serviceUrl) throw new ConnectionError("服务地址为空");
  if (!endpoint) throw new ShapeError("endpoint 不能为空");

  const baseUrl = serviceUrl.replace(/\/+$/, "");
  const queryStr = buildQuery(params);
  const url = `${baseUrl}/${endpoint}${queryStr}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json, text/plain, */*" },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ConnectionError(`服务错误 (${res.status}): ${text.slice(0, 500)}`);
    }

    const contentType = res.headers.get("content-type") || "";
    const raw = await res.text();

    // 尝试 JSON 解析
    try {
      const json = JSON.parse(raw);
      return parseResponse(endpoint, json);
    } catch {
      // 非 JSON 响应（如章节内容可能是纯文本）
      return raw;
    }
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new TimeoutError(`上游超时 (${timeoutMs}ms)`);
    }
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.message.includes("fetch failed")) {
      throw new ConnectionError(`无法连接服务: ${err.message}`);
    }
    if (err.name === "AuthError" || err.name === "ShapeError" || err.name === "ConnectionError") {
      throw err;
    }
    throw new ConnectionError(`请求错误: ${err.message}`);
  }
}

// ============================================================
// 以下为各工具的高阶封装
// ============================================================

/**
 * 连接检测——取书架首页验证连通性。
 */
export async function ping(serviceUrl) {
  const data = await callLegadoApi(serviceUrl, "getBookshelf", { count: 5, type: 0 });
  const books = data?.books || (Array.isArray(data) ? data : []);
  return books;
}

/**
 * 获取书架列表。
 * @param {string} serviceUrl
 * @param {string} [type="0"] - 0=全部, 1=最近
 * @param {number} [count=100]
 */
export async function getBookshelf(serviceUrl, type = "0", count = 100) {
  const data = await callLegadoApi(serviceUrl, "getBookshelf", { count, type });
  const books = data?.books || (Array.isArray(data) ? data : []);
  return books;
}

/**
 * 获取书籍信息。
 * @param {string} serviceUrl
 * @param {string} bookUrl - 书籍 URL（在 getBookshelf 中返回的 bookUrl 字段）
 */
export async function getBookInfo(serviceUrl, bookUrl) {
  if (!bookUrl) throw new ShapeError("bookUrl 不能为空");
  return await callLegadoApi(serviceUrl, "getBookInfo", { id: bookUrl });
}

/**
 * 获取章节目录。
 * @param {string} serviceUrl
 * @param {string} bookUrl - 书籍 URL
 */
export async function getBookChapters(serviceUrl, bookUrl) {
  if (!bookUrl) throw new ShapeError("bookUrl 不能为空");
  const data = await callLegadoApi(serviceUrl, "getChapterList", { url: bookUrl });
  return Array.isArray(data) ? data : (data?.chapters || data?.data || []);
}

/**
 * 获取章节正文。
 * @param {string} serviceUrl
 * @param {string} bookUrl
 * @param {number} index - 章节索引
 */
export async function getChapterContent(serviceUrl, bookUrl, index = 0) {
  if (!bookUrl) throw new ShapeError("bookUrl 不能为空");
  return await callLegadoApi(serviceUrl, "getBookContent", { url: bookUrl, index });
}

/**
 * 获取笔记/书签列表。
 * @param {string} serviceUrl
 * @param {string} bookUrl
 */
/**
 * 获取书籍笔记/划线/书签。
 * Legado 端点是 getBookmarkList，返回该书所有书签。
 * @param {string} serviceUrl
 * @param {string} bookUrl
 */
export async function getBookNotes(serviceUrl, bookUrl) {
  if (!bookUrl) throw new ShapeError("bookUrl 不能为空");
  try {
    const data = await callLegadoApi(serviceUrl, "getBookmarkList", { url: bookUrl });
    const rawList = Array.isArray(data) ? data : (data?.bookmarks || data?.data || []);
    // 规范化书签格式
    return rawList.map(normalizeBookmark);
  } catch (err) {
    // getBookmarkList 可能对某些书报错（无书签时），返回空
    if (err.code === "connection" || err.code === "timeout") throw err;
    return [];
  }
}

/**
 * 将 Legado 原始书签数据规范化为统一格式。
 * Legado 书签字段（实测）：
 *   chapterName / chapterPos / bookmarkContent / createTime / type(划线/笔记)
 */
function normalizeBookmark(b) {
  return {
    bookId: b.bookUrl || "",
    bookName: b.bookName || "",
    chapterName: b.chapterName || "",
    chapterPos: b.chapterPos || 0,
    content: b.bookmarkContent || b.content || b.text || "",
    type: b.type || "bookmark", // bookmark / note / highlight
    createTime: b.createTime || b.durChapterTime || 0,
    color: b.color || "",
  };
}

/**
 * 获取所有书籍的笔记/划线（批量）。
 * @param {string} serviceUrl
 * @param {Array} books - 书架书籍列表（用于确定哪些书有笔记可查）
 * @param {number} concurrency - 并发数
 */
export async function getAllBookNotes(serviceUrl, books, concurrency = 3) {
  const allNotes = [];
  const batchSize = concurrency;
  for (let i = 0; i < books.length; i += batchSize) {
    const batch = books.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(b => getBookNotes(serviceUrl, b.bookUrl).catch(() => []))
    );
    for (let j = 0; j < results.length; j++) {
      const notes = results[j].status === "fulfilled" ? results[j].value : [];
      // 夹带书信息到每条笔记
      for (const n of notes) {
        if (!n.bookName) n.bookName = batch[j]?.name || "";
      }
      allNotes.push(...notes);
    }
  }
  return allNotes;
}

/**
 * 书源搜索（WebSocket）。
 * Legado 新版搜书通过 WebSocket 端口（HTTP port + 1）进行。
 * 参考 api.md: URL = ws://127.0.0.1:1235/searchBook, Message = { key: [String] }
 * @param {string} serviceUrl - HTTP 地址，如 http://192.168.1.84:1122
 * @param {string} keyword
 * @param {number} [count=20]
 */
export async function searchBooks(serviceUrl, keyword, count = 20) {
  if (!keyword) throw new ShapeError("keyword 不能为空");

  // 解析 HTTP URL，将端口 +1 得到 WebSocket 端口
  const baseUrl = serviceUrl.replace(/\/+$/, "");
  let wsUrl;
  try {
    const u = new URL(baseUrl);
    const wsPort = u.port ? String(parseInt(u.port, 10) + 1) : "1236";
    const protocol = u.protocol === "https:" ? "wss:" : "ws:";
    wsUrl = `${protocol}//${u.host.replace(/:\d+$/, "")}:${wsPort}/searchBook`;
  } catch {
    // 兜底：简单替换协议 + 端口+1
    const match = baseUrl.match(/^(https?:\/\/[^:]+):(\d+)$/);
    if (match) {
      const protocol = match[1] === "https:" ? "wss:" : "ws:";
      const port = String(parseInt(match[2], 10) + 1);
      wsUrl = `${protocol}${match[1].replace(/^https?:\/\//, "")}:${port}/searchBook`;
    } else {
      wsUrl = serviceUrl.replace(/^http/, "ws") + "/searchBook";
    }
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { try{ws.close()}catch{} reject(new ConnectionError(`搜索超时（15s）: 无法连接 ${wsUrl}`)); }, 15000);
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      clearTimeout(timeout);
      reject(new ConnectionError(`WebSocket 创建失败: ${err.message}`));
      return;
    }
    // WebSocket 连接超时
    const connTimer = setTimeout(() => { try{if(ws)ws.close()}catch{} reject(new ConnectionError(`搜索超时: WebSocket 连接 ${wsUrl} 无响应，请确认 Legado Web 服务已开启`)); }, 5000);
    ws.onopen = () => { clearTimeout(connTimer); ws.send(JSON.stringify({ key: keyword })); };
    ws.onmessage = (event) => {
      clearTimeout(timeout);
      ws.close();
      try {
        const data = JSON.parse(event.data);
        const books = Array.isArray(data) ? data : (data?.data || data?.books || []);
        resolve(books.slice(0, count));
      } catch (e) {
        // 非 JSON 响应：可能是原始文本
        resolve([]);
      }
    };
    ws.onerror = (err) => {
      clearTimeout(timeout);
      reject(new ConnectionError(`WebSocket 搜索失败: 无法连接到 ${wsUrl}（${err.message || "请确认 Legado Web 服务已开启"}）`));
    };
    ws.onclose = () => { /* ignore */ };
  });
}

/**
 * 获取阅读进度。
 * @param {string} serviceUrl
 * @param {string} bookUrl
 */
export async function getBookProgress(serviceUrl, bookUrl) {
  if (!bookUrl) throw new ShapeError("bookUrl 不能为空");
  const data = await callLegadoApi(serviceUrl, "getProgress", { url: bookUrl });
  return data;
}
