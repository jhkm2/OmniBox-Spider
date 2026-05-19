// @name Plex
// @author Copilot
// @description 直连 Plex 接口，填好 host 即可使用。支持多服务器、多库、剧集/电影播放、合集、plex.tv 自动发现
// @dependencies: axios
// @version 1.6.0
// @indexs 影视
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/流媒体/Plex.js

/**
 * ============================================================================
 * Plex OmniBox 爬虫
 * ============================================================================
 * 配置：只需填 host（Plex 地址）和 token。
 *   [{ "host": "http://your-plex-host:32400", "token": "...", "name": "ServerName" }]
 *
 * 如需内外分离（内网请求 API 用 host，客户端封面/播放用 externalUrl），可额外填 externalUrl。
 * 不填则默认 externalUrl = host。
 * 支持 plex.tv 账号 token，脚本会自动发现服务器地址和专属 token。
 * ============================================================================
 */

const axios = require("axios");
const http = require("http");
const https = require("https");

let OmniBox;
try { OmniBox = require("omnibox_sdk"); }
catch (_) { OmniBox = { log(l, m) { console.log(`[${l}] ${m}`); } }; }

// ==================== 账号配置 ====================
const defaultAccounts = [
  { host: "", token: "", name: "ServerName" },
];

let accounts = [...defaultAccounts];

// ==================== 工具 ====================
const axiosInstance = axios.create({
  timeout: 15000,
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
  httpAgent: new http.Agent({ keepAlive: true }),
  validateStatus: (s) => s >= 200,
});

const logInfo = (msg, data) => OmniBox.log("info", `[Plex] ${data ? `${msg}: ${JSON.stringify(data)}` : msg}`);
const logError = (msg, err) => OmniBox.log("error", `[Plex] ${msg}: ${err?.message || err}`);

function clean(s) { return String(s || "").trim(); }
function normHost(h) { const s = String(h || "").trim(); return s ? (s.endsWith("/") ? s.slice(0, -1) : s) : ""; }

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : r & 0x3 | 0x8).toString(16);
  });
}

function plexHeaders(token) {
  return {
    Accept: "application/json",
    "X-Plex-Token": token,
    "X-Plex-Client-Identifier": uuid(),
    "X-Plex-Product": "OmniBox",
    "X-Plex-Version": "1.0.0",
    "X-Plex-Device": "OmniBox",
    "X-Plex-Platform": "OmniBox",
  };
}

function getImageUrl(baseUrl, thumb, token) {
  if (!thumb) return "";
  if (thumb.startsWith("http")) return thumb;
  const path = thumb.startsWith("/") ? thumb : `/${thumb}`;
  return `${baseUrl}${path}?X-Plex-Token=${token}`;
}

async function requestJson(url, opts, token) {
  const t0 = Date.now();
  try {
    const headers = { ...plexHeaders(token), ...(opts.headers || {}) };
    const res = await axiosInstance.request({ url, ...opts, headers });
    logInfo(`请求完成 ${url.substring(0, 120)}`, { status: res.status, cost: `${Date.now() - t0}ms` });
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    return res.data;
  } catch (e) {
    logError(`请求失败 ${url.substring(0, 120)} cost=${Date.now() - t0}ms`, e);
    throw e;
  }
}

function extractContainer(data) {
  if (!data) return null;
  return data.MediaContainer || data;
}

// ==================== 服务器解析（含 plex.tv 自动发现） ====================
async function resolvePlexServer(account) {
  const PREFIX = "plex:resolved:";
  const TTL = 86400 * 365;

  if (account._resolved) return account._resolved;

  const externalUrl = normHost(account.externalUrl || account.host);

  const baseUrl = normHost(account.host);
  const token = account.token;

  // 持久化缓存
  if (baseUrl && token) {
    try {
      const cached = await OmniBox.getCache(`${PREFIX}${baseUrl}`);
      if (cached) {
        const p = JSON.parse(cached);
        const test = await axiosInstance.get(`${p.url || baseUrl}/library/sections?X-Plex-Token=${p.token}`, {
          headers: { Accept: "application/json" }, timeout: 3000,
        });
        if (test.status === 200) {
          logInfo("命中持久化缓存，直连成功");
          account._resolved = { baseUrl: p.url || baseUrl, token: p.token, clientUrl: externalUrl || p.url || baseUrl };
          return account._resolved;
        }
      }
    } catch (_) {}
  }

  // 直连
  if (baseUrl && token) {
    try {
      const test = await axiosInstance.get(`${baseUrl}/library/sections?X-Plex-Token=${token}`, {
        headers: { Accept: "application/json" }, timeout: 3000,
      });
      if (test.status === 200) {
        logInfo("服务器直连成功", { host: baseUrl });
        account._resolved = { baseUrl, token, clientUrl: externalUrl || baseUrl };
        try { await OmniBox.setCache(`${PREFIX}${baseUrl}`, JSON.stringify({ url: baseUrl, token }), TTL); } catch (_) {}
        return account._resolved;
      }
    } catch (_) {}
  }

  // plex.tv 发现
  if (!token) throw new Error("未配置 Plex Token");

  try {
    const res = await axiosInstance.get("https://plex.tv/api/v2/resources", {
      headers: { Accept: "application/json", "X-Plex-Token": token, "X-Plex-Client-Identifier": uuid() },
      timeout: 10000,
    });
    if (res.status !== 200 || !Array.isArray(res.data)) throw new Error("无法从 plex.tv 获取服务器列表");

    let matched = null;
    for (const r of res.data) {
      if (!r.provides || !r.provides.includes("server")) continue;
      if (baseUrl) {
        for (const c of r.connections || []) {
          if (`${c.protocol}://${c.address}:${c.port}` === baseUrl || c.address === baseUrl) { matched = r; break; }
        }
      } else {
        const lc = (r.connections || []).find(c => c.local);
        if (lc) { matched = r; break; }
      }
      if (matched) break;
    }
    if (!matched) matched = res.data.find(r => r.provides && r.provides.includes("server"));
    if (!matched) throw new Error("未找到可用的 Plex 服务器");

    const serverToken = matched.accessToken || token;
    const conn = (matched.connections || []).find(c => c.local) || matched.connections?.[0];
    if (!conn) throw new Error("服务器没有可用连接地址");

    const url = `${conn.protocol}://${conn.address}:${conn.port}`;
    logInfo("通过 plex.tv 发现服务器", { name: matched.name, url });

    account._resolved = { baseUrl: url, token: serverToken, clientUrl: externalUrl || url };
    try { await OmniBox.setCache(`${PREFIX}${baseUrl || url}`, JSON.stringify({ url, token: serverToken }), TTL); } catch (_) {}
    return account._resolved;
  } catch (e) {
    logError("plex.tv 发现服务器失败", e);
    if (baseUrl && token) {
      account._resolved = { baseUrl, token, clientUrl: externalUrl || baseUrl };
      return account._resolved;
    }
    throw new Error(`无法连接到 Plex 服务器: ${e.message}`);
  }
}

function parseId(compositeId) {
  const parts = String(compositeId || "").split("@", 2);
  if (parts.length !== 2) throw new Error(`无效的复合ID: ${compositeId}`);
  const idx = parseInt(parts[0], 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= accounts.length) throw new Error(`账号索引越界: ${idx}`);
  return { account: accounts[idx], accountIndex: idx, itemId: parts[1] };
}

async function resolveFromId(compositeId) {
  const { account, accountIndex, itemId } = parseId(compositeId);
  const { baseUrl, token, clientUrl } = await resolvePlexServer(account);
  return { account, accountIndex, itemId, baseUrl, token, clientUrl };
}

async function getChildren(baseUrl, ratingKey, token) {
  const data = await requestJson(`${baseUrl}/library/metadata/${ratingKey}/children`, {}, token);
  return extractContainer(data)?.Metadata || [];
}

// ==================== 解析函数 ====================
function mapVideoItem(item, accountIndex, clientUrl, token) {
  const ratingKey = String(item.ratingKey || item.key || "").replace(/^\D+/g, "");
  const title = clean(item.title || "");
  const year = item.year ? String(item.year) : "";

  let typeName = "";
  if (item.type === "movie" || item.librarySectionType === "movie") typeName = "电影";
  else if (item.type === "show" || item.librarySectionType === "show") typeName = "剧集";
  else typeName = item.type || "";

  let remarks = year;
  if (item.contentRating) remarks = `${item.contentRating} ${year}`;

  return {
    vod_id: `${accountIndex}@${ratingKey}`,
    vod_name: title,
    vod_pic: getImageUrl(clientUrl, item.thumb || item.art, token),
    vod_remarks: remarks.trim(),
    type_name: typeName,
    vod_year: year,
  };
}

// ==================== Handler ====================
module.exports = { home, category, detail, search, play };

let runner;
try { runner = require("spider_runner"); }
catch (_) { runner = { run() {} }; }
runner.run(module.exports);

async function home(params) {
  logInfo("进入首页，获取媒体库列表");

  const extAccounts = (() => {
    const ext = params.extend || params.ext || params.config;
    if (!ext) return null;
    if (Array.isArray(ext)) return ext;
    try { return JSON.parse(Buffer.from(String(ext), "base64").toString("utf8")); } catch (_) {
      try { return JSON.parse(String(ext)); } catch (e) { return null; }
    }
  })();

  if (extAccounts && extAccounts.length > 0) {
    accounts = extAccounts;
    logInfo("使用外部账号配置", { count: accounts.length });
  } else if (!accounts.length || (accounts.length === 1 && !accounts[0].host)) {
    logError("未配置 Plex 信息", new Error("请在 accounts 中填写 host 和 token"));
    return { class: [], list: [] };
  }

  const classList = [];

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    try {
      if (!acc.host && !acc.token) continue;
      const { baseUrl, token } = await resolvePlexServer(acc);
      const serverName = acc.name || `Server ${i + 1}`;
      logInfo(`连接服务器 ${serverName}`, { url: baseUrl });

      const data = await requestJson(`${baseUrl}/library/sections`, {}, token);
      const dirs = extractContainer(data)?.Directory || [];

      for (const d of dirs) {
        if (d.type !== "movie" && d.type !== "show") continue;
        classList.push({ type_id: `${i}@${d.key}`, type_name: `[${serverName}] ${d.title}` });

        try {
          const cd = await requestJson(`${baseUrl}/library/sections/${d.key}/collections`, {}, token);
          if (extractContainer(cd)?.size > 0) {
            classList.push({ type_id: `${i}@coll_${d.key}`, type_name: `[${serverName}] ${d.title}合集` });
          }
        } catch (_) {}
      }
      logInfo(`服务器 ${serverName} 媒体库获取完成`, { count: dirs.length });
    } catch (e) {
      logError(`首页获取失败 ${acc.name || `Server ${i + 1}`}`, e);
    }
  }

  return { class: classList, list: [] };
}

async function category(params) {
  const cid = params.categoryId || params.type_id || params.t || "";
  const pg = Math.max(1, parseInt(params.page || params.pg || "1", 10));
  logInfo("请求分类列表", { categoryId: cid, page: pg });

  try {
    const { baseUrl, token, itemId, accountIndex, clientUrl } = await resolveFromId(cid);

    // 合集
    if (itemId.startsWith("coll_")) {
      const libKey = itemId.replace("coll_", "");
      const cd = await requestJson(`${baseUrl}/library/sections/${libKey}/collections`, {}, token);
      const list = (extractContainer(cd)?.Metadata || [])
        .filter(c => c.type === "collection")
        .map(c => ({
          vod_id: `${accountIndex}@${c.ratingKey}`,
          vod_name: clean(c.title || ""),
          vod_pic: getImageUrl(clientUrl, c.thumb || c.art, token),
          vod_remarks: `合集 · ${c.childCount || 0}部`,
          type_name: "合集",
        }));
      return { list, page: 1, pagecount: 1, total: list.length };
    }

    const limit = 50;
    const start = (pg - 1) * limit;
    const data = await requestJson(`${baseUrl}/library/sections/${itemId}/all`, {
      headers: { "X-Plex-Container-Start": String(start), "X-Plex-Container-Size": String(limit) },
      params: { sort: "year:desc" },
    }, token);

    const container = extractContainer(data);
    const items = container?.Metadata || [];
    const total = parseInt(container?.totalSize || container?.size || items.length, 10);
    const list = items
      .filter(it => it.type === "movie" || it.type === "show")
      .map(it => mapVideoItem(it, accountIndex, clientUrl, token));

    return { list, page: pg, pagecount: total > 0 ? Math.ceil(total / limit) : pg, total };
  } catch (e) {
    logError("分类请求失败", e);
    return { list: [], page: pg, pagecount: 0, total: 0 };
  }
}

async function detail(params) {
  const idList = (() => {
    const ids = params.ids || params.id || params.videoId || "";
    return Array.isArray(ids) ? ids : String(ids).split(",").map(s => s.trim()).filter(Boolean);
  })();
  logInfo("请求详情", { ids: idList });

  const result = { list: [] };

  for (const id of idList) {
    try {
      const { baseUrl, token, itemId, accountIndex, clientUrl } = await resolveFromId(id);
      const data = await requestJson(`${baseUrl}/library/metadata/${itemId}`, {}, token);
      const item = extractContainer(data)?.Metadata?.[0];
      if (!item) throw new Error("未找到媒体信息");

      const year = item.year ? String(item.year) : "";
      const vod = {
        vod_id: id,
        vod_name: clean(item.title || ""),
        vod_pic: getImageUrl(clientUrl, item.thumb || item.art, token),
        type_name: item.type === "movie" ? "电影" : item.type === "show" ? "剧集" : item.type === "collection" ? "合集" : "",
        vod_year: year,
        vod_content: clean(item.summary || (item.type === "collection" ? `合集，共 ${item.childCount || 0} 部影片` : "")),
        vod_remarks: item.type === "collection" ? `合集 · ${item.childCount || 0}部` : (item.contentRating ? `${item.contentRating} ${year}`.trim() : year),
      };

      if (item.Director) {
        vod.vod_director = (Array.isArray(item.Director) ? item.Director : [item.Director])
          .map(d => d.tag || "").filter(Boolean).join(",");
      }
      if (item.Role) {
        vod.vod_actor = (Array.isArray(item.Role) ? item.Role : [item.Role])
          .slice(0, 5).map(r => r.tag || "").filter(Boolean).join(",");
      }
      if (item.Genre && (!vod.type_name || vod.type_name === "电影" || vod.type_name === "剧集")) {
        const genres = (Array.isArray(item.Genre) ? item.Genre : [item.Genre])
          .map(g => g.tag || "").filter(Boolean).slice(0, 5);
        if (genres.length) vod.type_name = genres.join("/");
      }

      const playSources = [];

      if (item.type === "collection") {
        try {
          const cd = await requestJson(`${baseUrl}/library/collections/${itemId}/items`, {}, token);
          for (const ci of extractContainer(cd)?.Metadata || []) {
            if (ci.type !== "movie") continue;
            playSources.push({
              name: clean(ci.title) || "未知",
              episodes: [{ name: clean(ci.title) || "正片", playId: `${accountIndex}@${ci.ratingKey}` }],
            });
          }
        } catch (e) { logError("获取合集内容失败", e); }
      } else if (item.type === "movie") {
        for (let mi = 0; mi < (item.Media || []).length; mi++) {
          const media = item.Media[mi];
          for (let pi = 0; pi < (media.Part || []).length; pi++) {
            const part = media.Part[pi];
            if (part.id) {
              const info = `${media.videoResolution || ""} ${media.videoCodec || ""} ${media.audioCodec || ""}`.trim();
              playSources.push({
                name: info || "默认",
                episodes: [{ name: clean(item.title) || "正片", playId: `${accountIndex}@${itemId}|${mi}|${pi}`, size: part.size || 0 }],
              });
            }
          }
        }
        if (!playSources.length) {
          playSources.push({
            name: "Plex",
            episodes: [{ name: clean(item.title) || "正片", playId: `${accountIndex}@${itemId}` }],
          });
        }
      } else if (item.type === "show") {
        try {
          const seasons = await getChildren(baseUrl, itemId, token);
          for (const se of seasons) {
            if (se.type !== "season" || !se.ratingKey) continue;
            if (se.title === "无季" || se.title === "No Season" || se.index === 0) continue;
            const eps = await getChildren(baseUrl, se.ratingKey, token);
            const epList = eps.filter(ep => ep.type === "episode").map(ep => ({
              name: `第${se.index || ""}季 第${ep.index || ""}集 ${clean(ep.title) || ""}`.trim(),
              playId: `${accountIndex}@${se.ratingKey}|${ep.ratingKey}`,
            }));
            if (epList.length) playSources.push({ name: se.title || `第${se.index || ""}季`, episodes: epList });
          }
        } catch (e) {
          logError("获取剧集失败", e);
          try {
            const all = await getChildren(baseUrl, itemId, token);
            const eps = all.filter(ep => ep.type === "episode").map(ep => ({
              name: `第${ep.parentIndex || ""}季 第${ep.index || ""}集 ${clean(ep.title) || ""}`.trim(),
              playId: `${accountIndex}@${itemId}|${ep.ratingKey}`,
            }));
            if (eps.length) playSources.push({ name: "全部剧集", episodes: eps });
          } catch (_) {}
        }
      }

      vod.vod_play_sources = playSources.length ? playSources : undefined;
      result.list.push(vod);
    } catch (e) {
      logError(`详情获取失败 id=${id}`, e);
      result.list.push({ vod_id: id, vod_name: "获取详情失败" });
    }
  }

  return result;
}

async function search(params) {
  const kw = params.keyword || params.wd || "";
  const pg = Math.max(1, parseInt(params.page || params.pg || "1", 10));
  logInfo("搜索", { keyword: kw, page: pg });
  if (!kw) return { page: 1, pagecount: 0, total: 0, list: [] };

  const list = [];
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    try {
      if (!acc.host && !acc.token) continue;
      const { baseUrl, token, clientUrl } = await resolvePlexServer(acc);
      const data = await requestJson(`${baseUrl}/hubs/search?query=${encodeURIComponent(kw)}&limit=50`, {}, token);
      for (const hub of extractContainer(data)?.Hub || []) {
        for (const it of hub.Metadata || []) {
          if (it.type !== "movie" && it.type !== "show") continue;
          const vod = mapVideoItem(it, i, clientUrl, token);
          vod.vod_name = `[${acc.name || `Server ${i + 1}`}] ${vod.vod_name}`;
          list.push(vod);
        }
      }
    } catch (e) { logError(`搜索失败 ${acc.name || `Server ${i + 1}`}`, e); }
  }
  return { list, page: pg, pagecount: pg, total: list.length };
}

async function play(params, context) {
  const playId = params.playId || params.id || "";
  const from = context?.from || "web";
  logInfo("准备播放", { playId, from });

  try {
    const { baseUrl, token, itemId, clientUrl } = await resolveFromId(playId);
    const parts = itemId.split("|");

    if (parts.length >= 3) {
      const mi = parseInt(parts[1], 10), pi = parseInt(parts[2], 10);
      const data = await requestJson(`${baseUrl}/library/metadata/${parts[0]}`, {}, token);
      const part = extractContainer(data)?.Metadata?.[0]?.Media?.[mi]?.Part?.[pi];
      if (part?.key) {
        logInfo("播放地址 (Part File)", { clientUrl });
        return { parse: 0, urls: [{ name: "播放", url: `${clientUrl}${part.key}?X-Plex-Token=${token}` }], flag: "Plex", header: { Referer: `${clientUrl}/` } };
      }
    }

    if (parts.length >= 2) {
      const epData = await requestJson(`${baseUrl}/library/metadata/${parts[1]}`, {}, token);
      const key = extractContainer(epData)?.Metadata?.[0]?.Media?.[0]?.Part?.[0]?.key;
      if (key) {
        logInfo("播放地址 (Episode)", { clientUrl });
        return { parse: 0, urls: [{ name: "播放", url: `${clientUrl}${key}?X-Plex-Token=${token}` }], flag: "Plex", header: { Referer: `${clientUrl}/` } };
      }
    }

    if (parts.length === 1) {
      const data = await requestJson(`${baseUrl}/library/metadata/${parts[0]}`, {}, token);
      const key = extractContainer(data)?.Metadata?.[0]?.Media?.[0]?.Part?.[0]?.key;
      if (key) {
        logInfo("播放地址 (通用)", { clientUrl });
        return { parse: 0, urls: [{ name: "播放", url: `${clientUrl}${key}?X-Plex-Token=${token}` }], flag: "Plex", header: { Referer: `${clientUrl}/` } };
      }
    }

    throw new Error("无法获取播放地址");
  } catch (e) {
    logError("播放解析失败", e);
    return { parse: 1, urls: [], flag: "Plex", header: {}, msg: `播放错误: ${e.message}` };
  }
}
