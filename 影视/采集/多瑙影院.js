// @name 多瑙影院
// @description 页面解析：https://dnvod.org，支持首页、筛选分类、搜索、详情、多线路直连与嗅探兜底
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/多瑙影院.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const HOST = String(process.env.DNVOD_HOST || "https://dnvod.org").replace(/\/+$/, "");
const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Referer: `${HOST}/`,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const CLASS_LIST = [
  { type_id: "movie", type_name: "电影" },
  { type_id: "tv", type_name: "电视剧" },
  { type_id: "show", type_name: "综艺" },
  { type_id: "anime", type_name: "动漫" },
  { type_id: "doc", type_name: "纪录片" },
];

const option = (name, value) => ({ name, value });
const COMMON_REGIONS = [
  option("全部", ""), option("大陆", "cn"), option("港台", "hk_tw"),
  option("日韩", "jp_kr"), option("欧美", "west"), option("东南亚", "sea"), option("其他", "other"),
];
const ANIME_REGIONS = [option("全部", ""), option("日本", "jp"), option("大陆", "cn"), option("欧美", "west")];
const YEARS = [
  option("全部", ""), option("2026", "2026"), option("2025", "2025"), option("2024", "2024"),
  option("2023", "2023"), option("2022", "2022"), option("2021", "2021"), option("2020", "2020"),
  option("2010年代", "range__2010_2019"), option("2000年代", "range__2000_2009"), option("更早", "lt__2000"),
];
const MOVIE_GENRES = [
  option("全部", ""), option("喜剧", "xi-ju"), option("爱情", "ai-qing"), option("动作", "dong-zuo"),
  option("犯罪", "fan-zui"), option("科幻", "ke-huan"), option("奇幻", "qi-huan"), option("冒险", "mao-xian"),
  option("灾难", "zai-nan"), option("惊悚", "jing-song"), option("剧情", "ju-qing"), option("战争", "zhan-zheng"),
  option("歌舞", "ge-wu"), option("经典", "jing-dian"), option("悬疑", "xuan-yi"),
];
const SHOW_GENRES = [
  option("全部", ""), option("真人秀", "zhen-ren-xiu"), option("搞笑", "gao-xiao"), option("选秀", "xuan-xiu"),
  option("脱口秀", "tuo-kou-xiu"), option("音乐", "yin-le"), option("晚会", "wan-hui"),
  option("美食", "mei-shi"), option("访谈", "fang-tan"),
];
const ANIME_GENRES = [
  option("全部", ""), option("热血", "re-xue"), option("动作", "dong-zuo"), option("战争", "zhan-zheng"),
  option("青春", "qing-chun"), option("治愈", "zhi-yu"), option("运动", "yun-dong"), option("科幻", "ke-huan"),
  option("魔幻", "mo-huan"), option("冒险", "mao-xian"), option("推理", "tui-li"), option("搞笑", "gao-xiao"),
  option("校园", "xiao-yuan"), option("百合", "bai-he"),
];

const FILTERS = Object.fromEntries(CLASS_LIST.map((item) => [item.type_id, buildFilters(item.type_id)]));
const SOURCE_NAMES = { xlzy: "XL", jyzy: "JY", mdzy: "MD", hnzy: "HN", gszy: "GS", jszy: "JS", yhzy: "YH" };
const SOURCE_PRIORITY = ["xlzy", "jyzy", "mdzy", "hnzy", "gszy", "jszy", "yhzy"];

module.exports = { home, category, search, detail, play };
runner.run(module.exports);

function buildFilters(categoryId) {
  const filters = [];
  if (categoryId === "movie") filters.push({ key: "genre", name: "分类", value: MOVIE_GENRES });
  if (categoryId === "show") filters.push({ key: "genre", name: "分类", value: SHOW_GENRES });
  if (categoryId === "anime") filters.push({ key: "genre", name: "分类", value: ANIME_GENRES });
  filters.push({ key: "region", name: "地区", value: categoryId === "anime" ? ANIME_REGIONS : COMMON_REGIONS });
  filters.push({ key: "year", name: "年代", value: YEARS });
  return filters;
}

function getBodyText(response) {
  const body = response && typeof response === "object"
    ? ("body" in response ? response.body : ("data" in response ? response.data : response))
    : response;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.toString();
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
  if (statusCode < 200 || statusCode >= 400) throw new Error(`HTTP ${statusCode || "unknown"} @ ${url}`);
  return getBodyText(response);
}

async function requestJson(url, options = {}) {
  const text = await requestText(url, {
    ...options,
    headers: { "X-Requested-With": "XMLHttpRequest", ...(options.headers || {}) },
  });
  try {
    return JSON.parse(text || "{}");
  } catch (_) {
    return {};
  }
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

function extractFirst(pattern, text) {
  const match = String(text || "").match(pattern);
  return match ? cleanText(match[1]) : "";
}

function parseCards(html) {
  const text = String(html || "");
  const videos = [];
  const seen = new Set();
  const detailRegex = /href=["']\/(movie|tv|show|anime|doc)\/detail\/(\d+)["']/gi;
  let match;

  while ((match = detailRegex.exec(text)) !== null) {
    const categoryId = match[1].toLowerCase();
    const videoId = match[2];
    const vodId = `${categoryId}$${videoId}`;
    if (seen.has(vodId)) continue;

    const position = match.index;
    const window = text.slice(position, position + 1800);
    const around = text.slice(Math.max(0, position - 600), position + 900);
    let vodName = extractFirst(/<div[^>]+class=["'][^"']*text-left\s+text-truncate\s+text-dark[^"']*["'][^>]*>([\s\S]*?)<\/div>/i, window);
    if (!vodName) {
      const linkPattern = new RegExp(`href=["']\\/${categoryId}\\/detail\\/${videoId}["'][^>]*>([\\s\\S]*?)<\\/a>`, "i");
      vodName = extractFirst(linkPattern, window);
    }

    const picMatch = window.match(/<img\b[^>]*src=["']([^"']+)["']/i)
      || around.match(/<img\b[^>]*src=["']([^"']+)["']/i);
    const remarks = [];
    const remarkRegex = /<div[^>]+class=["'][^"']*small\s+text-truncate[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
    let remarkMatch;
    while ((remarkMatch = remarkRegex.exec(window)) !== null) {
      const value = cleanText(remarkMatch[1]);
      if (value) remarks.push(value);
    }
    const vodRemarks = remarks.find((value) => /人气|第|HD|4K|TC|正片/i.test(value)) || remarks[0] || "";

    if (!vodName || vodName.length >= 80) continue;
    seen.add(vodId);
    videos.push({
      vod_id: vodId,
      vod_name: vodName,
      vod_pic: absUrl(picMatch ? picMatch[1] : ""),
      vod_remarks: vodRemarks,
    });
  }

  return videos;
}

function normalizeFilters(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function parseVideoId(input) {
  const value = String(Array.isArray(input) ? input[0] : (input || "")).trim();
  if (value.includes("$")) {
    const [categoryId, videoId] = value.split("$", 2);
    return { categoryId: categoryId || "movie", videoId };
  }
  const match = value.match(/\/(movie|tv|show|anime|doc)\/detail\/(\d+)/i);
  if (match) return { categoryId: match[1].toLowerCase(), videoId: match[2] };
  return { categoryId: "movie", videoId: value };
}

function normalizeEpisodes(episodes) {
  const seen = new Set();
  const normalized = episodes.filter((episode) => {
    const key = `${episode.name}\n${episode.path}`;
    if (!episode.path || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!normalized.some((episode) => /-ep\d+/i.test(episode.path))) return normalized;
  return normalized.sort((a, b) => {
    const aMatch = a.path.match(/-ep(\d+)/i);
    const bMatch = b.path.match(/-ep(\d+)/i);
    return (aMatch ? Number(aMatch[1]) : Number.MAX_SAFE_INTEGER) - (bMatch ? Number(bMatch[1]) : Number.MAX_SAFE_INTEGER);
  });
}

function parseEpisodes(html) {
  const episodes = [];
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(String(html || ""))) !== null) {
    if (!/\bep-btn\b/i.test(getAttribute(match[1], "class"))) continue;
    const href = getAttribute(match[1], "href").split("#", 1)[0];
    if (!/^\/?play\//i.test(href)) continue;
    episodes.push({ name: cleanText(match[2]) || "播放", path: href.replace(/^\/+/, "") });
  }
  return normalizeEpisodes(episodes);
}

function episodeToApi(playPath) {
  const value = String(playPath || "").split("#", 1)[0].replace(/^\/+/, "").replace(/^play\//i, "");
  const separator = value.indexOf("-");
  if (separator < 0) return { videoId: value, episode: "" };
  return { videoId: value.slice(0, separator), episode: value.slice(separator + 1) };
}

function playApiUrl(playPath) {
  const { videoId, episode } = episodeToApi(playPath);
  return `${HOST}/vod_plays/${videoId}/${episode}`;
}

function sourceName(sourceSite) {
  const value = String(sourceSite || "").toLowerCase();
  return SOURCE_NAMES[value] || value.replace(/zy$/i, "").toUpperCase() || "默认";
}

function parseMetadata(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return extractFirst(new RegExp(`<div[^>]*>\\s*${escaped}\\s*[：:]\\s*([\\s\\S]*?)<\\/div>`, "i"), html);
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

function isDirectMedia(url) {
  return /\.(?:m3u8|mp4|flv|mkv)(?:$|[?#])/i.test(String(url || ""));
}

function directPlayResult(url, referer, name = "播放") {
  const header = { "User-Agent": UA, Referer: referer || `${HOST}/` };
  return { parse: 0, jx: 0, url, urls: [{ name, url }], header, headers: header };
}

function browserSniffResult(url, referer, name = "播放页") {
  const header = { "User-Agent": UA, Referer: referer || url || `${HOST}/` };
  return { parse: 1, jx: 1, url, urls: [{ name, url }], header, headers: header };
}

async function serverSniffOrBrowserFallback(targetUrl, name = "播放") {
  const header = { "User-Agent": UA, Referer: targetUrl };
  if (typeof OmniBox.sniffVideo === "function") {
    try {
      const sniffed = await OmniBox.sniffVideo(targetUrl, header);
      const urls = normalizeSniffUrls(sniffed, name);
      if (urls.length) {
        const playHeader = sniffed?.header || sniffed?.headers || header;
        await OmniBox.log("info", `[多瑙影院][play] 服务端嗅探成功 urls=${urls.length}`);
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
      await OmniBox.log("warn", "[多瑙影院][play] 服务端嗅探无结果，转浏览器嗅探");
    } catch (error) {
      await OmniBox.log("warn", `[多瑙影院][play] 服务端嗅探失败，转浏览器嗅探: ${error.message}`);
    }
  }
  return browserSniffResult(targetUrl, targetUrl, name);
}

async function resolveM3u8Child(url, referer) {
  try {
    const text = await requestText(url, { referer, timeout: 15000 });
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
    await OmniBox.log("warn", `[多瑙影院][home] 首页请求失败，改用分类页: ${error.message}`);
  }

  if (!list.length) {
    try {
      const results = await Promise.allSettled(CLASS_LIST.map((item) => requestText(`${HOST}/${item.type_id}/list/`)));
      const seen = new Set();
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const video of parseCards(result.value)) {
          if (seen.has(video.vod_id)) continue;
          seen.add(video.vod_id);
          list.push(video);
        }
      }
    } catch (error) {
      await OmniBox.log("error", `[多瑙影院][home] 分类页兜底失败: ${error.message}`);
    }
  }

  return { class: CLASS_LIST, filters: FILTERS, list: list.slice(0, 72) };
}

async function category(params) {
  const page = Math.max(1, parseInt(params.page || 1, 10));
  try {
    const categoryId = String(params.categoryId || params.type_id || "movie").trim() || "movie";
    const filters = normalizeFilters(params.extend || params.filters || params.ext);
    const query = new URLSearchParams();
    for (const key of ["genre", "region", "year"]) {
      const value = String(filters[key] || "").trim();
      if (value) query.set(key, value);
    }
    if (page !== 1) query.set("page", String(page));
    const suffix = query.toString();
    const url = `${HOST}/${categoryId}/list/${suffix ? `?${suffix}` : ""}`;
    const list = parseCards(await requestText(url));
    const pagecount = list.length ? page + 1 : page;
    return { page, pagecount, limit: list.length || 48, total: pagecount * (list.length || 48), list };
  } catch (error) {
    await OmniBox.log("error", `[多瑙影院][category] ${error.message}`);
    return { page, pagecount: 0, limit: 0, total: 0, list: [] };
  }
}

async function search(params) {
  const page = Math.max(1, parseInt(params.page || 1, 10));
  try {
    const keyword = String(params.keyword || params.wd || params.key || "").trim();
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };
    const query = new URLSearchParams({ q: keyword });
    if (page !== 1) query.set("page", String(page));
    const list = parseCards(await requestText(`${HOST}/search?${query.toString()}`));
    const pagecount = list.length ? page + 1 : page;
    return { page, pagecount, total: pagecount * Math.max(list.length, 1), list };
  } catch (error) {
    await OmniBox.log("error", `[多瑙影院][search] ${error.message}`);
    return { page, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params) {
  try {
    const { categoryId, videoId } = parseVideoId(params.videoId || params.id || params.categoryId);
    if (!videoId) return { list: [] };
    const detailUrl = `${HOST}/${categoryId}/detail/${videoId}`;
    const html = await requestText(detailUrl);
    const name = extractFirst(/<h1[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i, html)
      || extractFirst(/<title>([\s\S]*?)在线/i, html);
    const picMatch = html.match(/<img\b[^>]*alt=["'][^"']*["'][^>]*src=["']([^"']+)["']/i);
    const actor = extractFirst(/主演\s*[：:]\s*<\/span>([\s\S]*?)<br\s*\/?\s*>/i, html);
    const description = extractFirst(/<small[^>]*class=["'][^"']*text-secondary[^"']*["'][^>]*>([\s\S]*?)<\/small>/i, html);
    const episodes = parseEpisodes(html);

    let playSources = [];
    if (episodes.length) {
      try {
        const probe = episodes[episodes.length - 1].path;
        const probeData = await requestJson(playApiUrl(probe), { referer: absUrl(`/${probe}`), timeout: 15000 });
        const lines = Array.isArray(probeData.video_plays) ? probeData.video_plays : [];
        const usedNames = new Map();
        playSources = lines.map((line, index) => {
          const baseName = sourceName(line.src_site);
          const count = (usedNames.get(baseName) || 0) + 1;
          usedNames.set(baseName, count);
          const name = count > 1 ? `${baseName}${count}` : baseName;
          return {
            name,
            episodes: episodes.map((episode) => ({ name: episode.name, playId: `${episode.path}@@${index}` })),
          };
        });
      } catch (error) {
        await OmniBox.log("warn", `[多瑙影院][detail] 线路探测失败: ${error.message}`);
      }
    }
    if (!playSources.length && episodes.length) {
      playSources = [{ name: "多瑙优选", episodes: episodes.map((episode) => ({ name: episode.name, playId: episode.path })) }];
    }

    return {
      list: [{
        vod_id: `${categoryId}$${videoId}`,
        vod_name: name,
        vod_pic: absUrl(picMatch ? picMatch[1] : `/vod-img/${videoId}.jpg`),
        type_name: parseMetadata(html, "分类"),
        vod_year: parseMetadata(html, "年份"),
        vod_area: parseMetadata(html, "区域"),
        vod_lang: parseMetadata(html, "语言"),
        vod_actor: actor,
        vod_director: parseMetadata(html, "导演"),
        vod_content: description,
        vod_play_sources: playSources,
      }],
    };
  } catch (error) {
    await OmniBox.log("error", `[多瑙影院][detail] ${error.message}`);
    return { list: [] };
  }
}

async function play(params) {
  const rawPlayId = String(params.playId || params.id || params.url || "").trim();
  if (!rawPlayId) return { parse: 0, jx: 0, url: "", urls: [], header: {}, headers: {} };
  if (isDirectMedia(rawPlayId)) return directPlayResult(absUrl(rawPlayId), `${HOST}/`);

  let playPath = rawPlayId;
  let lineIndex = null;
  if (playPath.includes("@@")) {
    const parts = playPath.split("@@");
    playPath = parts.slice(0, -1).join("@@");
    const parsed = Number(parts[parts.length - 1]);
    if (Number.isInteger(parsed)) lineIndex = parsed;
  }
  if (/^https?:\/\//i.test(playPath)) {
    const match = playPath.match(/\/play\/([^?#]+)/i);
    playPath = match ? `play/${match[1]}` : playPath;
  }
  playPath = playPath.replace(/^\/+/, "");
  const playPageUrl = /^https?:\/\//i.test(playPath) ? playPath : absUrl(`/${playPath}`);

  try {
    const data = await requestJson(playApiUrl(playPath), { referer: playPageUrl, timeout: 20000 });
    const lines = Array.isArray(data.video_plays) ? data.video_plays : [];
    let selected = lineIndex !== null && lineIndex >= 0 && lineIndex < lines.length ? lines[lineIndex] : null;
    if (!selected) {
      for (const site of SOURCE_PRIORITY) {
        selected = lines.find((item) => String(item?.src_site || "").toLowerCase() === site && item?.play_data);
        if (selected) break;
      }
    }
    if (!selected) selected = lines.find((item) => item?.play_data) || null;

    let mediaUrl = String(selected?.play_data || "").trim();
    if (mediaUrl.startsWith("//")) mediaUrl = `https:${mediaUrl}`;
    if (mediaUrl) {
      if (/\.m3u8(?:$|[?#])/i.test(mediaUrl)) mediaUrl = await resolveM3u8Child(mediaUrl, playPageUrl);
      return directPlayResult(mediaUrl, `${HOST}/`, sourceName(selected?.src_site));
    }
  } catch (error) {
    await OmniBox.log("warn", `[多瑙影院][play] 播放接口失败，尝试嗅探: ${error.message}`);
  }

  return await serverSniffOrBrowserFallback(playPageUrl, "多瑙播放");
}
