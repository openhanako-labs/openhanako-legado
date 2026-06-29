// index.js
// legado-companion 生命周期 + EventBus 入口 + 凭据管理入口。
// 架构完全对齐 weread-companion 的插件 SDK 模式。

import { writeCredentials, readCredentials, clearCredentials, redactUrl } from "./tools/_lib/credentials.js";

const HANA_BUS_SKIP = Symbol.for("hana.event-bus.skip");

// ---------- capability metadata ----------

const STATUS_CAPABILITY = {
  title: "阅读伴脑状态",
  description: "查询阅读伴脑插件的就绪状态、版本、暴露的 surface 列表。",
  inputSchema: {
    type: "object",
    properties: { pluginId: { type: "string", description: "查询方插件 ID（可选）" } },
  },
  outputSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      pluginId: { type: "string" },
      name: { type: "string" },
      version: { type: "string" },
      surface: { type: "array", items: { type: "string", enum: ["page", "widget"] } },
    },
  },
  errors: ["BAD_PAYLOAD"],
  owner: "plugin:legado-companion",
  stability: "stable",
};

const CREDENTIALS_SET_CAPABILITY = {
  title: "设置开源阅读服务地址",
  description: "通过 iframe protocol 写入开源阅读 Web 服务地址（如 http://192.168.1.84:1122）和可选的 accessToken。地址加密落盘。",
  inputSchema: {
    type: "object",
    properties: {
      serviceUrl: { type: "string", description: "开源阅读 Web 服务地址，如 http://192.168.1.84:1122" },
      accessToken: { type: "string", description: "服务器版登录 accessToken（APP 自带版不需要）" },
    },
    required: ["serviceUrl"],
  },
  outputSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      url: { type: "string", description: "红化后的地址（[REDACTED]...）" },
      code: { type: "string" },
      hint: { type: "string" },
    },
  },
  errors: ["BAD_FORMAT", "WRITE_FAILED"],
  owner: "plugin:legado-companion",
  stability: "stable",
};

const CREDENTIALS_CLEAR_CAPABILITY = {
  title: "清除开源阅读服务地址",
  description: "删除本地加密存储的服务地址和 accessToken。",
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: { ok: { type: "boolean" }, code: { type: "string" }, message: { type: "string" } },
  },
  errors: ["WRITE_FAILED"],
  owner: "plugin:legado-companion",
  stability: "stable",
};

const CREDENTIALS_SOURCE_CAPABILITY = {
  title: "查询开源阅读服务状态",
  description: "返回当前服务地址来源、是否已配置。",
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      source: { type: "string", enum: ["local-encrypted", "decrypt_failed", null] },
      hasService: { type: "boolean" },
    },
  },
  errors: [],
  owner: "plugin:legado-companion",
  stability: "stable",
};

const RECOMMEND_CAPABILITY = {
  title: "书单智能推荐",
  description: "基于阅读历史和偏好，从 Legado 书源搜索并推荐书籍。三层漏斗：关键词提取→书源搜索→排序生成理由。",
  inputSchema: {
    type: "object",
    properties: {
      count: { type: "number", description: "推荐数量，默认 5" },
      mode: { type: "string", enum: ["conservative", "balanced", "aggressive"], description: "推荐模式，默认 balanced" },
      type: { type: "string", description: "按类型筛选（可选）" },
      excludeUrls: { type: "array", items: { type: "string" }, description: "排除的 bookUrl 列表" },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      recommendations: { type: "array" },
      mode: { type: "string" },
      count: { type: "number" },
      meta: { type: "object" },
    },
  },
  errors: ["NO_SERVICE", "TOOL_ERROR"],
  owner: "plugin:legado-companion",
  stability: "alpha",
};

// ---------- plugin ----------

class LegadoCompanionPlugin {
  constructor() {
    this._disposers = [];
  }

  async onload(ctxOrNone, helpers) {
    const ctx = ctxOrNone || this.ctx;
    this.ctx = ctx;
    const register = (helpers && helpers.register) || ((handle) => {
      if (handle && typeof handle.dispose === "function") {
        this._disposers.push(() => handle.dispose());
      }
    });

    if (ctx.bus?.handle) {
      // 1) 状态查询
      register(ctx.bus.handle(
        "legado-companion:status",
        (payload) => {
          if (payload?.pluginId && payload.pluginId !== ctx.pluginId) return HANA_BUS_SKIP;
          return {
            ok: true,
            pluginId: ctx.pluginId,
            name: "阅读",
            version: "0.1.0",
            surface: ["page", "widget"],
          };
        },
        { capability: STATUS_CAPABILITY },
      ));

      // 2) 凭据写入入口
      register(ctx.bus.handle(
        "credentials.set",
        (payload) => {
          const serviceUrl = payload?.serviceUrl;
          if (!serviceUrl || typeof serviceUrl !== "string") {
            return { ok: false, code: "bad_format", hint: "服务地址不能为空" };
          }
          // 标准化 URL：去掉尾部斜杠
          const normalizedUrl = serviceUrl.replace(/\/+$/, "");
          try {
            writeCredentials(ctx.dataDir, normalizedUrl, payload?.accessToken);
            ctx.log?.info?.("credentials updated via bus", { url: redactUrl(normalizedUrl) });
            return { ok: true, url: redactUrl(normalizedUrl) };
          } catch (err) {
            ctx.log?.error?.("credentials.set failed", { error: err.message });
            return { ok: false, code: "write_failed", message: err.message };
          }
        },
        { capability: CREDENTIALS_SET_CAPABILITY },
      ));

      // 3) 凭据抹除
      register(ctx.bus.handle(
        "credentials.clear",
        () => {
          try {
            const r = clearCredentials(ctx.dataDir);
            ctx.log?.info?.("credentials cleared via bus", r);
            return { ok: true, cleared: r.cleared, source: r.source, still_has: r.still_has };
          } catch (err) {
            return { ok: false, code: "write_failed", message: err.message };
          }
        },
        { capability: CREDENTIALS_CLEAR_CAPABILITY },
      ));

      // 4) 凭据来源查询
      register(ctx.bus.handle(
        "credentials.source",
        () => {
          const { source, value } = readCredentials(ctx.dataDir);
          return { ok: true, source, hasService: Boolean(value) };
        },
        { capability: CREDENTIALS_SOURCE_CAPABILITY },
      ));

      // 5) 书单推荐
      register(ctx.bus.handle(
        "legado-companion:recommend",
        async (payload) => {
          try {
            const { default: recommend } = await import("./tools/legado_recommend_books.js");
            return await recommend(payload || {}, { ...ctx, log: ctx.log });
          } catch (err) {
            ctx.log?.error?.("recommend failed via bus", { error: err.message });
            return { ok: false, code: "tool_error", message: err.message };
          }
        },
        { capability: RECOMMEND_CAPABILITY },
      ));

      // 6) 每日阅读打卡
      register(ctx.bus.handle(
        "legado-companion:daily-log",
        async (payload) => {
          try {
            const { default: dailyLog } = await import("./tools/legado_daily_log.js");
            return await dailyLog(payload || {}, { ...ctx, log: ctx.log });
          } catch (err) {
            ctx.log?.error?.("daily-log failed via bus", { error: err.message });
            return { ok: false, code: "tool_error", message: err.message };
          }
        },
        { capability: { title: "每日阅读打卡", description: "自动生成今日阅读记录并写入 Obsidian 日记", stability: "alpha" } },
      ));

      // 7) 主题书单
      register(ctx.bus.handle(
        "legado-companion:booklist",
        async (payload) => {
          try {
            const { default: booklist } = await import("./tools/legado_save_booklist.js");
            return await booklist(payload || {}, { ...ctx, log: ctx.log });
          } catch (err) {
            ctx.log?.error?.("booklist failed via bus", { error: err.message });
            return { ok: false, code: "tool_error", message: err.message };
          }
        },
        { capability: { title: "主题书单管理", description: "创建/列举/查看主题书单，支持分享到 Obsidian", stability: "alpha" } },
      ));

      // 8) 偏好演化
      register(ctx.bus.handle(
        "legado-companion:preference-evolution",
        async (payload) => {
          try {
            const { default: evolution } = await import("./tools/legado_preference_evolution.js");
            return await evolution(payload || {}, { ...ctx, log: ctx.log });
          } catch (err) {
            ctx.log?.error?.("preference-evolution failed via bus", { error: err.message });
            return { ok: false, code: "tool_error", message: err.message };
          }
        },
        { capability: { title: "偏好演化追踪", description: "对比阅读偏好的变化趋势，输出演化报告", stability: "alpha" } },
      ));

      // 9) RSS 书讯摄入
      register(ctx.bus.handle(
        "legado-companion:rss-intake",
        async (payload) => {
          try {
            const { default: rssIntake } = await import("./tools/legado_rss_intake.js");
            return await rssIntake(payload || {}, { ...ctx, log: ctx.log });
          } catch (err) {
            ctx.log?.error?.("rss-intake failed via bus", { error: err.message });
            return { ok: false, code: "tool_error", message: err.message };
          }
        },
        { capability: { title: "RSS 书讯摄入", description: "从 RSS 订阅源拉取新书资讯，并入推荐池", stability: "alpha" } },
      ));
    }

    ctx.log?.info?.("阅读伴脑 loaded", {
      dataDir: ctx.dataDir ? "[set]" : "[missing]",
      bus: Boolean(ctx.bus?.handle),
    });
  }

  async onunload() {
    while (this._disposers.length) {
      const d = this._disposers.pop();
      try { d(); } catch { /* swallow */ }
    }
    this.ctx?.log?.info?.("阅读伴脑 unloaded");
  }
}

export default LegadoCompanionPlugin;
