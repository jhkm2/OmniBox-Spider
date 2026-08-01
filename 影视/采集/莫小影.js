// @name 莫小影
// @description 莫小影（现千千影视）页面解析，支持首页、分类、搜索、详情、多线路播放与嗅探兜底
// @version 1.0.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/莫小影.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const HOST = String(process.env.QQYS_HOST || process.env.MOXY_HOST || "https://www.qqys01.com").replace(/\/+$/, "");
const SITE_ORIGIN = new URL(HOST).origin;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Referer: `${HOST}/`,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9",
};
const CLASS_LIST = [
  { type_id: "1", type_name: "电影" },
  { type_id: "2", type_name: "连续剧" },
  { type_id: "3", type_name: "综艺" },
  { type_id: "4", type_name: "动漫" },
  { type_id: "5", type_name: "短剧" },
];
const CATEGORY_IDS = new Set(CLASS_LIST.map((item) => item.type_id));
const AREA_NAMES = new Set([
  "中国大陆", "大陆", "中国", "香港", "中国香港", "台湾", "中国台湾",
  "美国", "日本", "韩国", "英国", "法国", "德国", "泰国", "印度",
  "加拿大", "西班牙", "意大利", "澳大利亚", "俄罗斯", "其他",
]);

module.exports = { home, category, search, detail, play };
runner.run(module.exports);

function getBodyText(response) {
  const body = response && typeof response === "object"
    ? ("body" in response ? response.body : ("data" in response ? response.data : response))
    : response;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  return String(body || "");
}

async function requestText(url, options = {}) {
  const response = await OmniBox.request(url, {
    method: options.method || "GET",
    headers: {
      ...HEADERS,
      ...(options.headers || {}),
      Referer: options.referer || options.headers?.Referer || `${HOST}/`,
    },
    timeout: options.timeout || 30000,
    body: options.body,
  });
  const statusCode = Number(response?.statusCode || 200);
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`HTTP ${statusCode || "unknown"} @ ${url}`);
  }
  return getBodyText(response);
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (entity, code) => {
      const number = Number(code);
      return Number.isInteger(number) && number >= 0 && number <= 0x10FFFF ? String.fromCodePoint(number) : entity;
    })
    .replace(/&#x([0-9a-f]+);/gi, (entity, code) => {
      const number = parseInt(code, 16);
      return Number.isInteger(number) && number >= 0 && number <= 0x10FFFF ? String.fromCodePoint(number) : entity;
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value) {
  return decodeHtml(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function absUrl(value, base = HOST) {
  let url = decodeHtml(String(value || "").trim())
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\\//g, "/");
  if (!url || /^data:/i.test(url)) return "";
  if (url.startsWith("//")) url = `https:${url}`;
  try {
    return new URL(url, base).toString();
  } catch (_) {
    return url;
  }
}

function getAttribute(attrs, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(attrs || "").match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeHtml(match[2]).trim() : "";
}

function findAttribute(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(html || "").match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
    if (match && match[2]) return decodeHtml(match[2]).trim();
  }
  return "";
}

function parseCards(html) {
  const text = String(html || "");
  const list = [];
  const seen = new Set();
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(text)) !== null) {
    const attrs = match[1] || "";
    const inner = match[2] || "";
    const href = getAttribute(attrs, "href");
    const idMatch = href.match(/\/voddetail\/?(\d+)\.html/i);
    if (!idMatch || seen.has(idMatch[1])) continue;

    const className = getAttribute(attrs, "class");
    if (!/module-(?:poster-item|card-item-poster)/i.test(className) && !/<img\b/i.test(inner)) continue;

    let name = cleanText(getAttribute(attrs, "title"));
    if (!name) name = cleanText(findAttribute(inner, ["alt", "title"]));
    if (!name) {
      const titleMatch = inner.match(/<div[^>]*class=["'][^"']*module-(?:poster|card)-item-title[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      name = cleanText(titleMatch ? titleMatch[1] : "");
    }
    if (!name) continue;

    const pic = findAttribute(inner, ["data-original", "data-src", "src"]);
    const remarkMatch = inner.match(/<div[^>]*class=["'][^"']*module-item-note[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

    seen.add(idMatch[1]);
    list.push({
      vod_id: idMatch[1],
      vod_name: name,
      vod_pic: absUrl(pic),
      vod_remarks: cleanText(remarkMatch ? remarkMatch[1] : ""),
    });
  }

  return list;
}

function parsePageCount(html, currentPage) {
  const pages = [Math.max(1, Number(currentPage) || 1)];
  const regex = /\/vod(?:show|search)\/[^"'?#]*?(\d+)---\.html/gi;
  let match;
  while ((match = regex.exec(String(html || ""))) !== null) {
    const page = Number(match[1]);
    if (Number.isFinite(page) && page > 0 && page <= 100000) pages.push(page);
  }
  return Math.max(...pages);
}

function getInfoTagValues(html) {
  const text = String(html || "");
  const start = text.search(/class=["'][^"']*module-info-tag[^"']*["']/i);
  if (start < 0) return [];
  const tail = text.slice(start, start + 5000);
  const end = tail.search(/class=["'][^"']*module-(?:mobile-play|info-content)[^"']*["']/i);
  const block = end > 0 ? tail.slice(0, end) : tail;
  const values = [];
  const seen = new Set();
  const anchorRegex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(block)) !== null) {
    const value = cleanText(match[1]);
    if (value && !seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

function extractInfoItem(html, label) {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(html || "").match(new RegExp(
    `<span[^>]*class=["'][^"']*module-info-item-title[^"']*["'][^>]*>\\s*${escaped}\\s*[：:]?\\s*<\\/span>\\s*<div[^>]*class=["'][^"']*module-info-item-content[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`,
    "i",
  ));
  return cleanText(match ? match[1] : "");
}

function normalizePeople(value) {
  return String(value || "").replace(/(?:\s*\/\s*)+$/g, "").trim();
}

function extractDescription(html) {
  const match = String(html || "").match(
    /<div[^>]*class=["'][^"']*module-info-introduction-content[^"']*["'][^>]*>\s*(?:<p[^>]*>)?([\s\S]*?)(?:<\/p>)?\s*<\/div>/i,
  );
  return cleanText(match ? match[1] : "");
}

function extractPoster(html) {
  const text = String(html || "");
  const start = text.search(/class=["'][^"']*module-info-poster[^"']*["']/i);
  const block = start >= 0 ? text.slice(start, start + 2500) : text;
  return absUrl(findAttribute(block, ["data-original", "data-src", "src"]));
}

function parsePlaySources(html) {
  const text = String(html || "");
  const sourceNames = [];
  const sourceNameRegex = /data-dropdown-value\s*=\s*(["'])([\s\S]*?)\1/gi;
  let match;
  while ((match = sourceNameRegex.exec(text)) !== null) {
    const name = cleanText(match[2]);
    if (name && !sourceNames.includes(name)) sourceNames.push(name);
  }

  const sources = [];
  const listRegex = /<div\b[^>]*class=["'][^"']*module-play-list-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let sourceIndex = 0;
  while ((match = listRegex.exec(text)) !== null) {
    const episodes = [];
    const seen = new Set();
    const episodeRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let episodeMatch;
    while ((episodeMatch = episodeRegex.exec(match[1])) !== null) {
      const href = getAttribute(episodeMatch[1], "href");
      if (!/\/vodplay\//i.test(href)) continue;
      const playId = absUrl(href);
      if (!playId || seen.has(playId)) continue;
      const title = cleanText(episodeMatch[2]) || cleanText(getAttribute(episodeMatch[1], "title")) || "播放";
      seen.add(playId);
      episodes.push({ name: title, playId });
    }
    const sourceName = sourceNames[sourceIndex] || `线路${sourceIndex + 1}`;
    sourceIndex += 1;
    if (episodes.length) sources.push({ name: sourceName, episodes });
  }
  return sources;
}

function toLegacyPlayFields(sources) {
  const safeName = (value) => String(value || "").replace(/[$#]/g, " ").trim();
  return {
    vod_play_from: sources.map((source) => safeName(source.name)).join("$$$"),
    vod_play_url: sources
      .map((source) => source.episodes.map((episode) => `${safeName(episode.name)}$${episode.playId}`).join("#"))
      .join("$$$"),
  };
}

function extractPlayerData(html) {
  const match = String(html || "").match(
    /(?:(?:var|let|const)\s+)?player_[A-Za-z0-9_$]+\s*=\s*(\{[\s\S]*?\})\s*;?/i,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (_) {
    return null;
  }
}

function safeDecodeURIComponent(value) {
  let result = String(value || "");
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(result);
      if (decoded === result) break;
      result = decoded;
    } catch (_) {
      break;
    }
  }
  return result;
}

function decodePlayerUrl(value, encrypt) {
  const raw = String(value || "").trim().replace(/\\\//g, "/");
  if (!raw) return "";
  try {
    if (String(encrypt) === "2") {
      const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      return safeDecodeURIComponent(Buffer.from(padded, "base64").toString("utf8"));
    }
    if (String(encrypt) === "1") return safeDecodeURIComponent(raw);
  } catch (_) {}
  return raw;
}

function isDirectMedia(url) {
  return /\.(?:m3u8|mp4|flv|m4s|mpd|mkv|avi)(?:$|[?#])/i.test(String(url || ""));
}

function directPlayResult(url, referer, name = "播放") {
  const header = { "User-Agent": UA, Referer: referer || `${HOST}/` };
  return { parse: 0, jx: 0, url, urls: [{ name, url }], header, headers: header };
}

function browserSniffResult(url, referer, name = "播放页") {
  const header = { "User-Agent": UA, Referer: referer || `${HOST}/` };
  return { parse: 1, jx: 1, url, urls: url ? [{ name, url }] : [], header, headers: header };
}

function emptyPlayResult() {
  return { parse: 0, jx: 0, url: "", urls: [], header: {}, headers: {} };
}

function isHttpUrl(url) {
  try {
    const protocol = new URL(String(url || "")).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch (_) {
    return false;
  }
}

function isSitePlayPage(url) {
  try {
    const parsed = new URL(String(url || ""));
    return isHttpUrl(parsed.toString())
      && parsed.origin === SITE_ORIGIN
      && /\/vodplay\//i.test(parsed.pathname);
  } catch (_) {
    return false;
  }
}

function normalizeSniffUrls(result, defaultName) {
  const urls = [];
  const seen = new Set();
  const append = (item) => {
    const url = String(typeof item === "string" ? item : (item?.url || item?.playUrl || item?.src || "")).trim();
    if (!isHttpUrl(url) || seen.has(url)) return;
    seen.add(url);
    urls.push({ name: String(item?.name || defaultName || "嗅探线路"), url });
  };
  if (Array.isArray(result?.urls)) result.urls.forEach(append);
  if (!urls.length) append(result);
  return urls;
}

async function sniffOrBrowserFallback(targetUrl, referer, name) {
  if (!isHttpUrl(targetUrl)) return emptyPlayResult();
  const header = { "User-Agent": UA, Referer: referer || `${HOST}/` };
  if (typeof OmniBox.sniffVideo === "function") {
    try {
      const sniffed = await OmniBox.sniffVideo(targetUrl, header);
      const urls = normalizeSniffUrls(sniffed, name);
      if (urls.length) {
        const playHeader = sniffed?.header || sniffed?.headers || header;
        return { parse: 0, jx: 0, url: urls[0].url, urls, header: playHeader, headers: playHeader };
      }
    } catch (error) {
      await OmniBox.log("warn", `[莫小影][play] 服务端嗅探失败: ${error.message}`);
    }
  }
  return browserSniffResult(targetUrl, referer, name);
}

async function home() {
  try {
    const html = await requestText(`${HOST}/`);
    return { class: CLASS_LIST, filters: {}, list: parseCards(html).slice(0, 60) };
  } catch (error) {
    await OmniBox.log("error", `[莫小影][home] ${error.message}`);
    return { class: CLASS_LIST, filters: {}, list: [] };
  }
}

async function category(params = {}) {
  const page = Math.max(1, parseInt(params.page || 1, 10) || 1);
  try {
    const requestedId = String(params.categoryId || params.type_id || params.tid || "1").trim();
    const categoryId = CATEGORY_IDS.has(requestedId) ? requestedId : "1";
    const url = page === 1
      ? `${HOST}/vodshow/${categoryId}-----------.html`
      : `${HOST}/vodshow/${categoryId}--------${page}---.html`;
    const html = await requestText(url);
    const list = parseCards(html);
    const limit = list.length || 20;
    const pagecount = parsePageCount(html, page);
    return { page, pagecount, limit, total: pagecount * limit, list };
  } catch (error) {
    await OmniBox.log("error", `[莫小影][category] ${error.message}`);
    return { page, pagecount: page, limit: 0, total: 0, list: [] };
  }
}

async function search(params = {}) {
  const page = Math.max(1, parseInt(params.page || 1, 10) || 1);
  try {
    const keyword = String(params.keyword || params.wd || params.key || "").trim();
    if (!keyword) return { page, pagecount: 0, limit: 0, total: 0, list: [] };
    const encoded = encodeURIComponent(keyword);
    const url = page === 1
      ? `${HOST}/vodsearch/${encoded}-------------.html`
      : `${HOST}/vodsearch/${encoded}----------${page}---.html`;
    const html = await requestText(url, { timeout: 60000 });
    const list = parseCards(html);
    const limit = list.length || 20;
    const pagecount = parsePageCount(html, page);
    return { page, pagecount, limit, total: pagecount * limit, list };
  } catch (error) {
    await OmniBox.log("error", `[莫小影][search] ${error.message}`);
    return { page, pagecount: page, limit: 0, total: 0, list: [] };
  }
}

async function detail(params = {}) {
  try {
    const input = String(params.videoId || params.id || params.vod_id || params.categoryId || "").trim();
    const idMatch = input.match(/\/voddetail\/?(\d+)\.html/i) || input.match(/^(\d+)$/);
    const videoId = idMatch ? idMatch[1] : "";
    if (!videoId) return { list: [] };

    const html = await requestText(`${HOST}/voddetail${videoId}.html`);
    const name = cleanText((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "")
      || cleanText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").split("-")[0].trim();
    const tags = getInfoTagValues(html);
    const year = tags.find((value) => /^\d{4}$/.test(value)) || "";
    const area = tags.find((value) => AREA_NAMES.has(value)) || (year && tags[tags.indexOf(year) + 1]) || "";
    const vodClass = tags.find((value) => value !== year && value !== area) || "";
    const playSources = parsePlaySources(html);
    const legacy = toLegacyPlayFields(playSources);

    return {
      list: [{
        vod_id: videoId,
        vod_name: name,
        vod_pic: extractPoster(html),
        vod_year: year,
        vod_area: area,
        vod_class: vodClass,
        vod_director: normalizePeople(extractInfoItem(html, "导演")),
        vod_actor: normalizePeople(extractInfoItem(html, "主演")),
        vod_content: extractDescription(html) || "暂无简介",
        vod_remarks: extractInfoItem(html, "集数") || extractInfoItem(html, "备注") || extractInfoItem(html, "更新"),
        vod_play_sources: playSources,
        ...legacy,
      }],
    };
  } catch (error) {
    await OmniBox.log("error", `[莫小影][detail] ${error.message}`);
    return { list: [] };
  }
}

async function play(params = {}) {
  const input = String(params.playId || params.id || params.url || params.input || "").trim();
  const flag = String(params.flag || "播放").trim() || "播放";
  if (!input) return browserSniffResult("", `${HOST}/`, flag);

  const playUrl = absUrl(input);
  if (isDirectMedia(playUrl)) {
    return isHttpUrl(playUrl) ? directPlayResult(playUrl, `${HOST}/`, flag) : emptyPlayResult();
  }

  if (!isSitePlayPage(playUrl)) {
    await OmniBox.log("warn", `[莫小影][play] 拒绝非本站播放页: ${playUrl}`);
    return emptyPlayResult();
  }
  try {
    const html = await requestText(playUrl, { referer: `${HOST}/`, timeout: 30000 });
    const player = extractPlayerData(html);
    const decoded = decodePlayerUrl(player?.url, player?.encrypt);
    const realUrl = decoded ? absUrl(decoded, playUrl) : "";
    const from = String(player?.from || "").toLowerCase();

    if (isHttpUrl(realUrl) && (isDirectMedia(realUrl) || /m3u8|mp4|flv/.test(from))) {
      return directPlayResult(realUrl, playUrl, flag);
    }
    if (isHttpUrl(realUrl)) return await sniffOrBrowserFallback(realUrl, playUrl, flag);

    const iframeMatch = html.match(/<iframe\b[^>]*src=["']([^"']+)["']/i);
    const sniffTarget = iframeMatch ? absUrl(iframeMatch[1], playUrl) : playUrl;
    return await sniffOrBrowserFallback(sniffTarget, playUrl, flag);
  } catch (error) {
    await OmniBox.log("error", `[莫小影][play] ${error.message}`);
    return await sniffOrBrowserFallback(playUrl, playUrl, flag);
  }
}