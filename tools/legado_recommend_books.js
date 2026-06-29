// tools/legado_recommend_books.js
// 书单推荐——三层漏斗智能推荐。
// Layer 1: 关键词提取（LLM 或降级）
// Layer 2: 书源搜索（真实数据）
// Layer 3: 排序+推荐理由（LLM 或降级）

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf } from "./_lib/legado-api.js";
import { extractKeywords, searchCandidates, rankAndRecommend } from "./_lib/recommend.js";
import { chatCompletion } from "./_lib/llm.js";

/**
 * 书单推荐工具。
 * @param {object} input
 * @param {number} [input.count=5] - 推荐数量
 * @param {"conservative"|"balanced"|"aggressive"} [input.mode="balanced"] - 推荐模式
 * @param {string} [input.type] - 按类型筛选（可选）
 * @param {string[]} [input.excludeUrls] - 排除已读的 bookUrl 列表
 * @param {object} ctx - plugin context
 */
export default async function legado_recommend_books(
  { count = 5, mode = "balanced", type = null, excludeUrls = [] } = {},
  ctx = {}
) {
  const { dataDir, bus } = ctx;
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  const countNum = Math.min(Math.max(count, 1), 10);
  const excludeSet = new Set(Array.isArray(excludeUrls) ? excludeUrls : []);

  try {
    // ---- 0. 读取书架数据 ----
    const books = await getBookshelf(serviceUrl, "0", 200);

    if (books.length === 0) {
      return {
        ok: true,
        recommendations: [],
        mode,
        hint: "书架上没有书籍，无法生成推荐。",
      };
    }

    // 已读书籍的 URL 集合（用于排除）
    const readUrls = new Set();
    for (const b of books) {
      if (b.bookUrl) readUrls.add(b.bookUrl);
    }
    // 合并且用户的排除
    for (const url of excludeSet) {
      readUrls.add(url);
    }

    // 获取阅读画像（尝试读缓存，快路径）
    let portrait = null;
    if (bus?.request) {
      try {
        const portraitPrompt = createPortraitPrompt(books);
        const portraitResult = await chatCompletion(ctx, {
          operation: "legado-companion-recommend-portrait",
          messages: [{ role: "user", content: portraitPrompt }],
          temperature: 0.4,
          maxTokens: 800,
        });
        if (portraitResult.ok) {
          const jsonMatch = portraitResult.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) portrait = JSON.parse(jsonMatch[0]);
        }
      } catch { /* 不阻塞推荐流程 */ }
    }

    // ---- 1. Layer 1：关键词提取 ----
    const { keywords, via: kwVia } = await extractKeywords(ctx, books, portrait);

    if (keywords.length === 0) {
      return {
        ok: true,
        recommendations: [],
        mode,
        hint: "无法提取推荐关键词，请确认书架有足够书籍数据。",
      };
    }

    // ---- 2. Layer 2：书源搜索 ----
    const candidates = await searchCandidates(serviceUrl, keywords, readUrls, 15);

    if (candidates.length === 0) {
      return {
        ok: true,
        recommendations: [],
        mode,
        keywords,
        hint: "搜索未找到匹配的候选书籍。请尝试其他关键词或检查书源。",
      };
    }

    // ---- 3. Layer 3：排序 + 推荐理由 ----
    const recommendations = await rankAndRecommend(ctx, books, candidates, countNum, mode);

    return {
      ok: true,
      recommendations,
      mode,
      count: recommendations.length,
      meta: {
        totalCandidates: candidates.length,
        keywordsUsed: keywords,
        keywordSource: kwVia,
        llmAvailable: bus?.request ? true : false,
      },
    };
  } catch (err) {
    return { ok: false, code: err.code || "unknown", message: err.message };
  }
}

/**
 * 快路径头像 prompt（比完整画像更轻量）。
 */
function createPortraitPrompt(books) {
  const kinds = {};
  const authors = {};
  for (const b of books) {
    const kind = (b.kind || "").trim();
    const author = (b.author || "").trim();
    if (kind) kinds[kind] = (kinds[kind] || 0) + 1;
    if (author) authors[author] = (authors[author] || 0) + 1;
  }
  const topKinds = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  const topAuthors = Object.entries(authors).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a]) => a);

  return `基于以下书架数据，生成简洁的阅读画像。只需 JSON 不要其他内容。

书架统计：
- 总书数：${books.length}
- 高频类型：${topKinds.join("、")}
- 高频作者：${topAuthors.join("、")}
- 样本（${Math.min(books.length, 10)} 本）：${books.slice(0, 10).map(b => `${b.name}(${b.kind || "未知类型"})`).join("、")}

{
  "keywords": ["高频类型/作者标签"],
  "pref": "一句话总结阅读偏好"
}`;
}
