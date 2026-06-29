// tools/legado_preference_evolution.js
// 偏好演化 — 追踪阅读偏好的变化趋势。
// 每次运行时对比当前偏好与上一次快照，输出变化报告。

import fs from "node:fs";
import path from "node:path";
import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf } from "./_lib/legado-api.js";
import { chatCompletion } from "./_lib/llm.js";
import { extractKeywords, rankFallback } from "./_lib/recommend.js";

const EVOLUTION_FILE = "preference-evolution.json";

/**
 * 偏好演化分析。
 * @param {object} input
 * @param {"analyze"|"history"} [input.action="analyze"] — analyze: 生成新分析并对比; history: 查看历史记录
 * @param {number} [input.historyLimit=5] — 返回历史记录条数
 */
export default async function legado_preference_evolution(
  { action = "analyze", historyLimit = 5 } = {},
  ctx = {}
) {
  const { dataDir, log, bus } = ctx;
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  const evoPath = path.join(dataDir, "legado-companion", EVOLUTION_FILE);

  // ---- 查看历史记录 ----
  if (action === "history") {
    try {
      if (fs.existsSync(evoPath)) {
        const data = JSON.parse(fs.readFileSync(evoPath, "utf-8"));
        const history = (data.history || []).slice(-historyLimit);
        return { ok: true, history, current: data.current || null };
      }
    } catch {}
    return { ok: true, history: [], current: null, hint: "尚无偏好演化记录" };
  }

  // ---- 分析 ----
  try {
    const books = await getBookshelf(serviceUrl, "0", 200);
    if (books.length === 0) {
      return { ok: false, code: "no_data", message: "书架为空" };
    }

    // 提取当前偏好特征
    const kinds = {};
    const authors = {};
    for (const b of books) {
      const kind = (b.kind || "").trim();
      const author = (b.author || "").trim();
      if (kind) kinds[kind] = (kinds[kind] || 0) + 1;
      if (author) authors[author] = (authors[author] || 0) + 1;
    }

    const topKinds = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topAuthors = Object.entries(authors).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const reading = books.filter(b => b.durChapterTitle && b.durChapterTitle.length > 0);
    const progressRates = reading.map(b => {
      return b.totalChapterNum > 0 ? ((b.durChapterIndex || 0) + 1) / b.totalChapterNum : 0;
    });
    const avgProgress = progressRates.length > 0
      ? Math.round(progressRates.reduce((a, b) => a + b, 0) / progressRates.length * 100)
      : 0;

    const snapshot = {
      timestamp: Date.now(),
      date: new Date().toISOString().split("T")[0],
      kinds: topKinds.map(([k, c]) => ({ kind: k, count: c })),
      authors: topAuthors.map(([a, c]) => ({ author: a, count: c })),
      totalBooks: books.length,
      readingCount: reading.length,
      avgProgress,
    };

    // 读取历史数据
    let history = [];
    let lastSnapshot = null;
    try {
      if (fs.existsSync(evoPath)) {
        const data = JSON.parse(fs.readFileSync(evoPath, "utf-8"));
        history = data.history || [];
        lastSnapshot = data.current || null;
      }
    } catch {}

    // 生成对比报告
    const changes = [];
    if (lastSnapshot) {
      // 类型变化
      const lastKinds = {};
      for (const k of lastSnapshot.kinds || []) lastKinds[k.kind] = k.count;
      const currentKinds = {};
      for (const k of topKinds) currentKinds[k[0]] = k[1];

      const newKinds = Object.keys(currentKinds).filter(k => !lastKinds[k]);
      const droppedKinds = Object.keys(lastKinds).filter(k => !currentKinds[k]);
      if (newKinds.length > 0) changes.push(`📈 新增兴趣类型：${newKinds.join("、")}`);
      if (droppedKinds.length > 0) changes.push(`📉 减少兴趣类型：${droppedKinds.join("、")}`);

      // 作者变化
      const lastAuthors = {};
      for (const a of lastSnapshot.authors || []) lastAuthors[a.author] = a.count;
      const newAuthors = topAuthors.filter(([a]) => !lastAuthors[a]).map(([a]) => a);
      if (newAuthors.length > 0) changes.push(`👤 新晋作者：${newAuthors.join("、")}`);

      // 阅读节奏变化
      const lastAvg = lastSnapshot.avgProgress || 0;
      const diff = avgProgress - lastAvg;
      if (Math.abs(diff) > 5) {
        changes.push(`📊 平均阅读进度 ${diff > 0 ? "提升" : "下降"} ${Math.abs(diff)}%（从 ${lastAvg}% 到 ${avgProgress}%）`);
      }

      // 总量变化
      const bookDiff = books.length - (lastSnapshot.totalBooks || 0);
      if (bookDiff > 0) changes.push(`📚 藏书增加 ${bookDiff} 本`);

      // LLM 风格分析（如果可用）
      if (changes.length > 0 && bus?.request) {
        try {
          const prompt = `用户 ${lastSnapshot.date} 的阅读偏好：${JSON.stringify(lastSnapshot.kinds)}\n用户今天的阅读偏好：${JSON.stringify(snapshot.kinds)}\n\n请用 2-3 句话总结阅读偏好的演化趋势，自然口语化。`;
          const llmResult = await chatCompletion(ctx, {
            operation: "legado-companion-evolution",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.4,
            maxTokens: 300,
          });
          if (llmResult.ok) changes.push(`💡 ${llmResult.text}`);
        } catch {}
      }
    } else {
      changes.push("🌱 首次记录，尚无对比基准");
    }

    // 保存
    history.push(snapshot);
    if (history.length > 30) history = history.slice(-30);
    fs.mkdirSync(path.dirname(evoPath), { recursive: true });
    fs.writeFileSync(evoPath, JSON.stringify({ current: snapshot, history }, null, 2), "utf-8");

    log?.info?.("preference evolution analyzed", {
      changes: changes.length,
      snapshots: history.length,
    });

    return {
      ok: true,
      current: snapshot,
      changes,
      snapshotCount: history.length,
      hasEvolution: lastSnapshot !== null,
    };
  } catch (err) {
    return { ok: false, code: err.code || "unknown", message: err.message };
  }
}