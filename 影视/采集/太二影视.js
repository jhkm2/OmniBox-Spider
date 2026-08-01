// @name 太二影视
// @description 太二追剧页面解析，支持首页、分类、搜索、详情、多线路播放和嗅探兜底
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/太二影视.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const HOST = String(process.env.TAI2_HOST || "https://v.tai2.lol").replace(/\/+$/, "");
const UA = "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Referer: `${HOST}/`,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9",
};
const CLASS_LIST = [
  { type_id: "21", type_name: "剧集" },
  { type_id: "22", type_name: "综艺" },
];

module.exports = { home, category, search, detail, play };
runner.run(module.exports);

function getBodyText(response) {
  const body = response && typeof response === "object"
    ? ("body" in response ? response.body : ("data" in response ? response.data : response))
    : response;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.toString();
  return String(body || "");
}

async function requestText(url, options = {}) {
  const headers = {
    ...HEADERS,
    ...(options.headers || {}),
    Referer: options.referer || options.headers?.Referer || `${HOST}/`,
  };
  const attempts = options.retries === undefined ? 2 : Math.max(1, Number(options.retries) + 1);
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await OmniBox.request(url, {
        method: options.method || "GET",
        headers,
        timeout: options.timeout || 30000,
        body: options.body,
      });
      const statusCode = Number(response?.statusCode || 200);
      if (statusCode === 520 && attempt + 1 < attempts) continue;
      if (statusCode < 200 || statusCode >= 400) {
        const error = new Error(`HTTP ${statusCode || "unknown"} @ ${url}`);
        error.retryable = false;
        throw error;
      }
      return getBodyText(response);
    } catch (error) {
      lastError = error;
      if (error?.retryable === false || attempt + 1 >= attempts) break;
    }
  }
  throw lastError || new Error(`请求失败 @ ${url}`);
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(text) {
  return decodeHtml(
    String(text || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function absUrl(url, base = HOST) {
  let value = decodeHtml(String(url || "").trim()).replace(/^['"]|['"]$/g, "");
  if (!value || /^data:/i.test(value)) return "";
  if (value.startsWith("//")) value = `https:${value}`;
  try {
    return new URL(value, base).toString();
  } catch (_) {
    return value;
  }
}

function getAttribute(attrs, name) {
  const match = String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeHtml(match[2]).trim() : "";
}

function lastCaptured(text, pattern) {
  let value = "";
  let match;
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  while ((match = regex.exec(String(text || ""))) !== null) {
    value = match[1] || "";
    if (!match[0]) regex.lastIndex += 1;
  }
  return value;
}

function parseCards(html) {
  const text = String(html || "");
  const videos = [];
  const seen = new Set();
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(text)) !== null) {
    const attrs = match[1] || "";
    const href = getAttribute(attrs, "href");
    const idMatch = href.match(/\/vod\/detail\/id\/(\d+)\.html/i);
    if (!idMatch) continue;
    const videoId = idMatch[1];
    if (seen.has(videoId)) continue;

    const inner = match[2] || "";
    const before = text.slice(Math.max(0, match.index - 700), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 700);
    let vodName = cleanText(getAttribute(attrs, "title"));
    if (!vodName) {
      const alt = lastCaptured(inner, /\balt\s*=\s*["']([^"']+)["']/i);
      vodName = cleanText(alt).replace(/封面图$/u, "").trim();
    }
    if (!vodName) {
      const titleMatch = after.match(/class=["'][^"']*time-title[^"']*["'][^>]*[^>]*title=["']([^"']+)["']/i);
      vodName = cleanText(titleMatch ? titleMatch[1] : "");
    }
    if (!vodName) continue;

    let vodPic = lastCaptured(inner, /\bdata-src\s*=\s*["']([^"']+)["']/i);
    if (!vodPic) vodPic = lastCaptured(inner, /\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!vodPic) vodPic = lastCaptured(before, /\bdata-src\s*=\s*["']([^"']+)["']/i);
    const remarkMatch = inner.match(/public-list-prb[^>]*>([\s\S]*?)<\/span>/i)
      || after.match(/public-list-prb[^>]*>([\s\S]*?)<\/span>/i);

    seen.add(videoId);
    videos.push({
      vod_id: videoId,
      vod_name: vodName,
      vod_pic: absUrl(vodPic),
      vod_remarks: cleanText(remarkMatch ? remarkMatch[1] : ""),
    });
  }

  return videos;
}

function extractPeopleBlock(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(html || "").match(
    new RegExp(`<div[^>]*class=["'][^"']*slide-info[^"']*["'][^>]*>[\\s\\S]*?<strong[^>]*>\\s*${escaped}\\s*[：:]?\\s*<\\/strong>([\\s\\S]*?)<\\/div>`, "i"),
  );
  if (!match) return "";
  const names = [];
  const linkRegex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(match[1])) !== null) {
    const name = cleanText(linkMatch[1]);
    if (name) names.push(name);
  }
  return names.length ? names.join(" ") : cleanText(match[1]);
}

function extractParameter(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(html || "").match(
    new RegExp(`<li[^>]*>[\\s\\S]*?<em[^>]*>\\s*${escaped}\\s*[：:]\\s*<\\/em>([\\s\\S]*?)<\\/li>`, "i"),
  );
  return cleanText(match ? match[1] : "");
}

function parsePlaySources(html) {
  const text = String(html || "");
  const tabStart = text.search(/\banthology-tab\b/i);
  const listStart = tabStart >= 0 ? text.slice(tabStart).search(/\banthology-list\b/i) : -1;
  const tabHtml = tabStart >= 0 && listStart > 0 ? text.slice(tabStart, tabStart + listStart) : "";
  const sourceNames = [];
  const sourceRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = sourceRegex.exec(tabHtml)) !== null) {
    if (!/\bswiper-slide\b/i.test(getAttribute(match[1], "class"))) continue;
    const withoutBadge = match[2].replace(/<span\b[^>]*class=["'][^"']*badge[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "");
    const name = cleanText(withoutBadge);
    if (name) sourceNames.push(name);
  }

  const sources = [];
  const listRegex = /<ul\b[^>]*class=["'][^"']*anthology-list-play[^"']*["'][^>]*>([\s\S]*?)<\/ul>/gi;
  let index = 0;
  while ((match = listRegex.exec(text)) !== null) {
    const episodes = [];
    const episodeRegex = /<a\b[^>]*href=["']([^"']*\/vod\/play\/id\/\d+\/sid\/\d+\/nid\/\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let episodeMatch;
    while ((episodeMatch = episodeRegex.exec(match[1])) !== null) {
      const name = cleanText(episodeMatch[2]);
      const playId = absUrl(episodeMatch[1]);
      if (name && playId) episodes.push({ name, playId });
    }
    if (episodes.length) sources.push({ name: sourceNames[index] || `线路${index + 1}`, episodes });
    index += 1;
  }
  return sources;
}

function decodePlayerUrl(value, encrypt) {
  let url = String(value || "").replace(/\\\//g, "/");
  try {
    if (String(encrypt) === "1") return decodeURIComponent(url);
    if (String(encrypt) === "2") return decodeURIComponent(Buffer.from(url, "base64").toString("utf8"));
  } catch (_) {}
  return url;
}

function isDirectMedia(url) {
  return /\.(?:m3u8|mp4|flv|mkv)(?:$|[?#])/i.test(String(url || ""));
}

function normalizeSniffUrls(result, defaultName) {
  const urls = [];
  const seen = new Set();
  const append = (item) => {
    const value = typeof item === "string" ? item : (item?.url || item?.playUrl || item?.src || "");
    const url = String(value || "").trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push({ name: String(item?.name || defaultName || "嗅探线路"), url });
  };
  if (Array.isArray(result?.urls)) result.urls.forEach(append);
  if (!urls.length) append(result);
  return urls;
}

function directPlayResult(url, referer, name = "播放") {
  const header = { "User-Agent": UA, Referer: referer || `${HOST}/` };
  return { parse: 0, jx: 0, url, urls: [{ name, url }], header, headers: header };
}

function browserSniffResult(url, referer, name = "播放页") {
  const header = { "User-Agent": UA, Referer: referer || url || `${HOST}/` };
  return { parse: 1, jx: 1, url, urls: [{ name, url }], header, headers: header };
}

async function serverSniffOrBrowserFallback(targetUrl, referer, name = "播放") {
  const header = { "User-Agent": UA, Referer: referer || `${HOST}/` };
  if (typeof OmniBox.sniffVideo === "function") {
    try {
      const sniffed = await OmniBox.sniffVideo(targetUrl, header);
      const urls = normalizeSniffUrls(sniffed, name);
      if (urls.length) {
        const playHeader = sniffed?.header || sniffed?.headers || header;
        await OmniBox.log("info", `[太二影视][play] 服务端嗅探成功 urls=${urls.length}`);
        return {
          parse: 0,
          jx: 0,
          url: urls[0].url,
          urls,
          header: playHeader,
          headers: playHeader,
          danmaku: sniffed?.danmaku || [],
        };
      }
      await OmniBox.log("warn", "[太二影视][play] 服务端嗅探无结果，转浏览器嗅探");
    } catch (error) {
      await OmniBox.log("warn", `[太二影视][play] 服务端嗅探失败，转浏览器嗅探: ${error.message}`);
    }
  }
  return browserSniffResult(targetUrl, referer, name);
}

async function resolveM3u8Child(url, referer) {
  try {
    const text = await requestText(url, { referer, timeout: 20000, retries: 0 });
    if (!text.includes("#EXTM3U") || !text.includes("#EXT-X-STREAM-INF")) return url;
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].startsWith("#EXT-X-STREAM-INF")) continue;
      const child = lines.slice(index + 1).find((line) => !line.startsWith("#"));
      if (child) return absUrl(child, url);
    }
  } catch (_) {}
  return url;
}

async function home() {
  let list = [];
  try {
    list = parseCards(await requestText(`${HOST}/`));
  } catch (error) {
    await OmniBox.log("warn", `[太二影视][home] 首页请求失败: ${error.message}`);
  }
  if (!list.length) {
    const results = await Promise.allSettled(CLASS_LIST.map((item) => requestText(`${HOST}/index.php/vod/type/id/${item.type_id}.html`)));
    const seen = new Set();
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const video of parseCards(result.value)) {
        if (seen.has(video.vod_id)) continue;
        seen.add(video.vod_id);
        list.push(video);
      }
    }
  }
  return { class: CLASS_LIST, filters: {}, list: list.slice(0, 72) };
}

async function category(params) {
  const page = Math.max(1, parseInt(params.page || 1, 10));
  try {
    const categoryId = String(params.categoryId || params.type_id || "21").trim() || "21";
    const pagePath = page > 1 ? `/page/${page}` : "";
    const url = `${HOST}/index.php/vod/type/id/${categoryId}${pagePath}.html`;
    const list = parseCards(await requestText(url));
    return { page, pagecount: 1, total: list.length, list };
  } catch (error) {
    await OmniBox.log("error", `[太二影视][category] ${error.message}`);
    return { page, pagecount: 0, total: 0, list: [] };
  }
}

async function search(params) {
  const page = Math.max(1, parseInt(params.page || 1, 10));
  const keyword = String(params.keyword || params.wd || params.key || "").trim();
  if (!keyword) return { page, pagecount: 0, total: 0, list: [] };
  const encoded = encodeURIComponent(keyword);
  const urls = [
    `${HOST}/index.php/vod/search.html?wd=${encoded}&page=${page}`,
    `${HOST}/vodsearch/${encoded}----------${page}.html`,
    `${HOST}/search.html?wd=${encoded}&page=${page}`,
  ];
  for (const url of urls) {
    try {
      const list = parseCards(await requestText(url));
      if (list.length) return { page, pagecount: 1, total: list.length, list };
    } catch (error) {
      await OmniBox.log("warn", `[太二影视][search] ${url} ${error.message}`);
    }
  }
  return { page, pagecount: 0, total: 0, list: [] };
}

async function detail(params) {
  try {
    const input = String(params.videoId || params.id || params.categoryId || "").trim();
    const idMatch = input.match(/\/vod\/detail\/id\/(\d+)\.html/i) || input.match(/^(\d+)$/);
    const videoId = idMatch ? idMatch[1] : "";
    if (!videoId) return { list: [] };
    const html = await requestText(`${HOST}/index.php/vod/detail/id/${videoId}.html`);
    const titleMatch = html.match(/<h3\b[^>]*class=["'][^"']*slide-info-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)
      || html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    const picMatch = html.match(/detail-pic[\s\S]*?<img\b[^>]*(?:data-src|src)=["']([^"']+)["']/i);
    const contentMatch = html.match(/id=["']height_limit["'][^>]*>([\s\S]*?)<\/div>/i);
    const remarkMatch = html.match(/slide-info-remarks[^>]*>([\s\S]*?)<\/span>/i);
    const playSources = parsePlaySources(html);

    return {
      list: [{
        vod_id: videoId,
        vod_name: cleanText(titleMatch ? titleMatch[1] : ""),
        vod_pic: absUrl(picMatch ? picMatch[1] : ""),
        type_name: extractPeopleBlock(html, "类型"),
        vod_year: extractParameter(html, "年份") || cleanText((html.match(/vod\/search\/year\/(\d{4})\.html/i) || [])[1] || ""),
        vod_area: extractParameter(html, "地区"),
        vod_remarks: cleanText(remarkMatch ? remarkMatch[1] : ""),
        vod_actor: extractPeopleBlock(html, "演员") || extractParameter(html, "主演"),
        vod_director: extractPeopleBlock(html, "导演") || extractParameter(html, "导演"),
        vod_content: cleanText(contentMatch ? contentMatch[1] : "") || "暂无简介",
        vod_play_sources: playSources,
      }],
    };
  } catch (error) {
    await OmniBox.log("error", `[太二影视][detail] ${error.message}`);
    return { list: [] };
  }
}

async function play(params) {
  const input = String(params.playId || params.id || params.url || params.input || "").trim();
  if (!input) return { parse: 0, jx: 0, url: "", urls: [], header: {}, headers: {} };
  if (isDirectMedia(input)) return directPlayResult(absUrl(input), `${HOST}/`);
  const playUrl = absUrl(input);

  let html = "";
  try {
    html = await requestText(playUrl, { referer: `${HOST}/`, timeout: 30000 });
  } catch (error) {
    await OmniBox.log("warn", `[太二影视][play] 播放页请求失败，尝试嗅探: ${error.message}`);
    return await serverSniffOrBrowserFallback(playUrl, playUrl, "太二播放");
  }

  const playerMatch = html.match(/var\s+player_[a-zA-Z0-9_$]+\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i)
    || html.match(/var\s+player_[a-zA-Z0-9_$]+\s*=\s*(\{[\s\S]*?\})\s*;/i);
  if (playerMatch) {
    try {
      const playerData = JSON.parse(playerMatch[1]);
      let realUrl = decodePlayerUrl(playerData.url, playerData.encrypt);
      if (isDirectMedia(realUrl)) {
        if (/\.m3u8(?:$|[?#])/i.test(realUrl)) realUrl = await resolveM3u8Child(realUrl, playUrl);
        return directPlayResult(realUrl, playUrl);
      }
      if (realUrl) return await serverSniffOrBrowserFallback(absUrl(realUrl, playUrl), playUrl, playerData.vod_data?.vod_name || "播放");
    } catch (error) {
      await OmniBox.log("warn", `[太二影视][play] player 数据解析失败: ${error.message}`);
    }
  }

  let sniffTarget = playUrl;
  const iframeMatch = html.match(/<iframe\b[^>]*src=["']([^"']+)["']/i);
  if (iframeMatch) {
    const iframeUrl = absUrl(iframeMatch[1], playUrl);
    sniffTarget = iframeUrl || playUrl;
    try {
      const iframeHtml = await requestText(iframeUrl, { referer: playUrl, timeout: 30000, retries: 0 });
      const iframePlayer = iframeHtml.match(/["']url["']\s*:\s*["']([^"']+)["']/i);
      let iframeMedia = decodeHtml(iframePlayer ? iframePlayer[1] : "").replace(/\\\//g, "/");
      if (!iframeMedia) {
        const mediaMatch = iframeHtml.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4|flv|mkv)(?:\?[^"']*)?)["']/i);
        iframeMedia = mediaMatch ? mediaMatch[1] : "";
      }
      if (isDirectMedia(iframeMedia)) {
        if (/\.m3u8(?:$|[?#])/i.test(iframeMedia)) iframeMedia = await resolveM3u8Child(iframeMedia, iframeUrl);
        return directPlayResult(iframeMedia, iframeUrl);
      }
      if (iframeMedia) return await serverSniffOrBrowserFallback(absUrl(iframeMedia, iframeUrl), iframeUrl, "播放");
    } catch (error) {
      await OmniBox.log("warn", `[太二影视][play] iframe 解析失败: ${error.message}`);
    }
  }

  const directMatch = html.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4|flv|mkv)(?:\?[^"']*)?)["']/i);
  if (directMatch) return directPlayResult(directMatch[1].replace(/\\\//g, "/"), playUrl);
  return await serverSniffOrBrowserFallback(sniffTarget, playUrl, "太二播放");
}
