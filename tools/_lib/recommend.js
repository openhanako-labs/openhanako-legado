// tools/_lib/recommend.js
// 推荐系统核心逻辑——三层漏斗实现。
// Layer 1: 关键词提取（LLM）
// Layer 2: 书源搜索（确定性）
// Layer 3: 排序+推荐理由（LLM）

import { searchBooks } from "./legado-api.js";
import { chatCompletion } from "./llm.js";

// ========== Layer 1: 关键词提取 ==========

const KEYWORD_EXTRACTION_SYSTEM = `你是一个书籍推荐关键词提取器。根据用户的阅读历史和画像，提取 3-5 个搜索关键词，用于从书源中找到他们会喜欢的书。

要求：
- 每个关键词应该是一个具体、可搜索的短语（如"硬科幻 太空歌剧"而不是"科幻类"）
- 关键词需要多样化：覆盖不同作者、类型、风格
- 如果用户有明确的偏好（如特定作者、子类型），优先提取这些

返回格式（仅 JSON，不要其他内容）：
{ "keywords": ["关键词1", "关键词2", ...] }`;

/**
 * Layer 1: 从阅读数据中提取搜索关键词。
 * @param {object} ctx - plugin context
 * @param {Array} books - 书架书籍列表
 * @param {object|null} portrait - 阅读画像（如有）
 * @returns {Promise<{keywords:string[], via:string}>}
 */
export async function extractKeywords(ctx, books, portrait) {
  const booksText = books.slice(0, 20).map((b, i) => {
    const kind = b.kind || "";
    const author = b.author || "未知";
    return `[${i + 1}] ${b.name} - ${author} (${kind})`;
  }).join("\n");

  const portraitText = portrait
    ? JSON.stringify({
        genres: portrait.keywords || portrait.genres || [],
        pref: portrait.pref || "",
        interests: portrait.interests || "",
      })
    : "(暂无画像)";

  const prompt = `阅读数据（前 20 本）：\n${booksText}\n\n阅读画像：\n${portraitText}\n\n请提取 3-5 个精准搜索关键词。`;

  const result = await chatCompletion(ctx, {
    operation: "legado-companion-recommend-keywords",
    systemPrompt: KEYWORD_EXTRACTION_SYSTEM,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    maxTokens: 500,
  });

  if (result.ok) {
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.keywords) && parsed.keywords.length > 0) {
          return { keywords: parsed.keywords.slice(0, 5), via: result.via };
        }
      }
    } catch {}
  }

  // LLM 不可用时：从书架数据提取关键词作为降级
  return { keywords: extractKeywordsFallback(books, portrait || {}), via: "fallback" };
}

/**
 * 关键词提取降级：从书籍类型和作者中提取高频词。
 */
function extractKeywordsFallback(books, portrait) {
  const keywords = new Set();

  // 从已有书籍的类型中提取高频类型
  const kindCount = {};
  const authorCount = {};
  for (const b of books) {
    const kind = (b.kind || "").trim();
    const author = (b.author || "").trim();
    if (kind) kindCount[kind] = (kindCount[kind] || 0) + 1;
    if (author) authorCount[author] = (authorCount[author] || 0) + 1;
  }

  // 取前 3 高频类型作为关键词
  const topKinds = Object.entries(kindCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);
  topKinds.forEach(k => keywords.add(k));

  // 取前 2 高频作者（只保留名字，不包含特殊字符）
  const topAuthors = Object.entries(authorCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([a]) => a.replace(/[\[\]{}()]/g, "").trim())
    .filter(a => a && a.length > 1);
  topAuthors.forEach(a => keywords.add(a));

  // 如果关键词太少，加一些通用方向
  if (keywords.size < 2) {
    keywords.add("小说");
    keywords.add("文学");
  }

  return Array.from(keywords).slice(0, 5);
}

// ========== Layer 2: 书源搜索 ==========

/**
 * Layer 2: 用关键词搜索 Legado 书源，去重并过滤已读。
 * @param {string} serviceUrl - Legado 服务地址
 * @param {string[]} keywords - 搜索关键词列表
 * @param {Set<string>} excludeUrls - 已读书籍的 bookUrl Set
 * @param {number} maxPerKeyword - 每个关键词最多返回数
 * @returns {Promise<Array>} 去重后的候选书籍
 */
export async function searchCandidates(serviceUrl, keywords, excludeUrls = new Set(), maxPerKeyword = 15) {
  const seen = new Set();
  const candidates = [];

  for (const kw of keywords) {
    try {
      const books = await searchBooks(serviceUrl, kw, maxPerKeyword);
      for (const b of books) {
        const id = b.bookUrl || b.name;
        if (seen.has(id)) continue;
        seen.add(id);
        if (excludeUrls.has(id)) continue; // 排除已读
        // 排除书名为"未知"/空的
        const name = (b.name || "").trim();
        if (!name || name === "未知") continue;
        candidates.push({
          title: name,
          author: (b.author || "").trim(),
          cover: b.coverUrl || "",
          intro: (b.intro || "").slice(0, 200),
          wordCount: b.wordCount || "",
          kind: b.kind || "",
          bookUrl: id,
          source: kw, // 标记来源关键词
        });
      }
    } catch (err) {
      // 单个关键词搜索失败不影响其他关键词
      continue;
    }
  }

  // 去重（相同标题+作者视为同一本）
  const deduped = [];
  const titleSet = new Set();
  for (const c of candidates) {
    const key = `${c.title}::${c.author}`.toLowerCase();
    if (titleSet.has(key)) continue;
    titleSet.add(key);
    deduped.push(c);
  }

  return deduped;
}

// ========== Layer 3: 排序+推荐理由 ==========

const RANKING_SYSTEM = `你是一个书籍推荐策展人。你的任务是：根据用户的阅读偏好，从候选书籍中选出最合适的一批，并为每本写一段自然的推荐理由。

推荐理由要求：
- 不要模板化，不要套话（如"这本书值得一读"）
- 具体指出书的特点、风格、与用户偏好的关联
- 如果用户读过类似书，明确说"因为你喜欢XX"
- 语言自然亲切，像朋友在推荐

返回 JSON 格式：
{
  "recommendations": [
    {
      "title": "书名",
      "author": "作者",
      "reason": "推荐理由（2-3句话，具体、自然）",
      "genres": ["类型标签"],
      "estimatedReadingTime": "预计阅读时间",
      "matchScore": 0.85
    }
  ]
}`;

/**
 * Layer 3: 用 LLM 对候选书籍排序，生成推荐理由。
 * @param {object} ctx - plugin context
 * @param {Array} books - 已读/在读的书籍（用户画像）
 * @param {Array} candidates - 候选书籍
 * @param {number} count - 推荐数量
 * @param {string} mode - balanced/aggressive
 * @returns {Promise<Array>}
 */
export async function rankAndRecommend(ctx, books, candidates, count = 5, mode = "balanced") {
  if (candidates.length === 0) {
    return [];
  }

  // 构建用户偏好摘要
  const userBooksText = books.slice(0, 15).map((b, i) => {
    const kind = b.kind || "";
    const author = b.author || "未知";
    const progress = b.durChapterTitle ? `读到: ${b.durChapterTitle}` : "在书架";
    return `[${i + 1}] ${b.name} - ${author} (${kind}) ${progress}`;
  }).join("\n");

  // 候选书摘要（太多的话截断，但保留完整 title 和 intro）
  const maxCandidates = mode === "aggressive" ? 40 : 25;
  const candidateText = candidates.slice(0, maxCandidates).map((c, i) => {
    return `[${i + 1}] 《${c.title}》- ${c.author} | ${c.kind} | ${(c.intro || "").slice(0, 100)}`;
  }).join("\n");

  const prompt = `用户的阅读记录（前 15 本）：\n${userBooksText}\n\n候选书籍（共 ${candidates.length} 本，列出前 ${maxCandidates} 本）：\n${candidateText}\n\n从候选书籍中选出 ${count} 本最推荐的，按匹配度从高到低排序。每本的 matchScore 用 0-1 的小数表示。`;

  const result = await chatCompletion(ctx, {
    operation: "legado-companion-recommend-rank",
    systemPrompt: RANKING_SYSTEM,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.5,
    maxTokens: 2000,
  });

  if (result.ok) {
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.recommendations)) {
          return parsed.recommendations.slice(0, count);
        }
      }
    } catch {} // JSON 解析失败，走降级
  }

  // LLM 不可用时：简单按类型匹配度排序
  return rankFallback(books, candidates, count);
}

/**
 * 排序降级：基于已有书籍的类型匹配度进行排序。
 */
export function rankFallback(userBooks, candidates, count) {
  // 提取用户常见的类型
  const kindFreq = {};
  for (const b of userBooks) {
    const kind = (b.kind || "").trim();
    if (kind) kindFreq[kind] = (kindFreq[kind] || 0) + 1;
  }
  const topKinds = new Set(
    Object.entries(kindFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k)
  );

  // 给候选书打分
  const scored = candidates.map(c => {
    let score = 0.3; // 基础分
    if (topKinds.has(c.kind)) score += 0.4; // 类型匹配
    if (c.intro && c.intro.length > 20) score += 0.1; // 有简介
    return { ...c, matchScore: Math.min(score, 1.0) };
  });

  return scored
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, count)
    .map(c => ({
      title: c.title,
      author: c.author,
      reason: c.matchScore > 0.6
        ? `匹配你喜欢的"${Array.from(topKinds).join("、")}"类型`
        : "新类型探索推荐",
      genres: c.kind ? [c.kind] : [],
      estimatedReadingTime: estimateReadingTime(c.wordCount),
      matchScore: Math.round(c.matchScore * 100) / 100,
    }));
}

/** 从字数估算阅读时间 */
function estimateReadingTime(wordCount) {
  const wc = parseInt(wordCount, 10);
  if (!wc || isNaN(wc)) return "未知";
  const hours = Math.ceil(wc / 10000);
  return `约 ${hours} 小时`;
}
