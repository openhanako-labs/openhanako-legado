// _lib/portrait.js
// AI 分析 prompt 构建——基于书架数据生成 LLM prompt。

const PORTRAIT_PROMPT = `你是一个阅读分析助手。请根据用户的书架数据，生成一份阅读画像。

用户书架上的书籍（共 {count} 本，列出前 30 本）：
{books}

用户查询：{query}

请从以下维度分析（输出简洁自然，不要模板化）：
1. 阅读偏好：喜欢的题材、作者、写作风格
2. 阅读节奏：书籍完成度、阅读持续情况
3. 兴趣领域：从书籍题材和简介中反映的关注点
4. 推荐建议：基于偏好可能的兴趣方向

输出格式：
{
  "pref": "...",
  "pace": "...",
  "interests": "...",
  "suggestions": "...",
  "keywords": ["...", "...", "..."]
}`;

/**
 * 构建书架数据 prompt（用于阅读画像）。
 */
export function buildBookshelfPrompt(books, query = "") {
  const booksText = books.slice(0, 30).map((b, i) => {
    const kind = b.kind || "";
    const wordCount = b.wordCount || "";
    const progress = b.durChapterTitle ? `读到: ${b.durChapterTitle}` : "未开始";
    return `[${i + 1}] ${b.name || "未知"} - ${b.author || "未知"} (${kind}) ${progress} ${wordCount}`;
  }).join("\n");

  return PORTRAIT_PROMPT
    .replace("{count}", String(books.length))
    .replace("{books}", booksText)
    .replace("{query}", query || "无");
}

/**
 * 构建思问 prompt——真正回答用户问题，不生成画像。
 */
export function buildAskPrompt(books, query) {
  const booksText = books.slice(0, 30).map((b, i) => {
    const kind = b.kind || "";
    const progress = b.durChapterTitle ? `读到: ${b.durChapterTitle}` : "未开始";
    return `[${i + 1}] 《${b.name || "未知"}》${b.author ? " - " + b.author : ""} (${kind}) ${progress}`;
  }).join("\n");

  return `用户书架上的书籍（共 ${books.length} 本，列出前 30 本）：
${booksText}

请基于以上书架数据回答用户的问题。回答要自然口语化，不要输出 JSON，直接说人话。

用户问题：${query}`;
}

/**
 * 解析 LLM 返回的画像 JSON。
 */
export function parsePortraitResponse(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch {
    return null;
  }
}