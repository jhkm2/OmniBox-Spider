// @name 275听书
// @author
// @description 275听书网有声小说源
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/听书/275听书.js

/**
 * OmniBox 听书源脚本：275听书
 *
 * 由 Python 版迁移为 OmniBox 标准五方法：home/category/search/detail/play。
 * 站点播放页依赖 PHP 会话，因此脚本会保存 Set-Cookie，并在直接播放时先初始化会话。
 */

const OmniBox = require("omnibox_sdk");

const SITE = "https://www.i275.com";
const SITE_HOST = new URL(SITE).hostname;
const DEFAULT_COVER = `${SITE}/uploads/bookcover.png`;
const PAGE_LIMIT = 20;
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: `${SITE}/`,
};

const CATEGORIES = [
  { type_id: "latest", type_name: "最近上架" },
  { type_id: "xuanhuan", type_name: "玄幻" },
  { type_id: "xiuxian", type_name: "修仙" },
  { type_id: "dushi", type_name: "都市" },
  { type_id: "yanqing", type_name: "言情" },
  { type_id: "chuanyue", type_name: "穿越" },
  { type_id: "chongsheng", type_name: "重生" },
  { type_id: "xuanyi", type_name: "悬疑" },
  { type_id: "lingyi", type_name: "灵异" },
  { type_id: "lishi", type_name: "历史" },
  { type_id: "wuxia", type_name: "武侠" },
  { type_id: "kehuan", type_name: "科幻" },
  { type_id: "wangyou", type_name: "网游" },
  { type_id: "guanchang", type_name: "官场" },
  { type_id: "junshi", type_name: "军事" },
  { type_id: "pingshu", type_name: "评书" },
  { type_id: "ertong", type_name: "儿童" },
  { type_id: "xiangsheng", type_name: "相声" },
  { type_id: "guangboju", type_name: "广播剧" },
  { type_id: "qita", type_name: "其他" },
];

const CATEGORY_QUERIES = {
  xuanhuan: "玄幻",
  xiuxian: "修仙",
  dushi: "都市",
  yanqing: "言情",
  chuanyue: "穿越",
  chongsheng: "重生",
  xuanyi: "悬疑",
  lingyi: "灵异",
  lishi: "历史",
  wuxia: "武侠",
  kehuan: "科幻",
  wangyou: "网游",
  guanchang: "官场",
  junshi: "军事",
  pingshu: "评书",
  ertong: "儿童",
  xiangsheng: "相声",
  guangboju: "广播剧",
  qita: "其他",
};

const cookieJar = {};
const searchCache = new Map();

function log(level, message) {
  try {
    OmniBox.log(level, `[275听书] ${message}`);
  } catch (_) {}
}

function pageNumber(value) {
  const page = parseInt(String(value || 1), 10);
  return Number.isNaN(page) ? 1 : Math.max(1, page);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function absoluteUrl(value, base = `${SITE}/`) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return new URL(text, base).toString();
  } catch (_) {
    return text;
  }
}

function buildUrl(base, params = {}) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value) {
  const withoutTags = String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtml(withoutTags).replace(/[ \t\r\f\v]+/g, " ").trim();
}

function safeEpisodeName(value) {
  return String(value || "").replace(/\$/g, "￥").replace(/#/g, "﹟");
}

function getHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") {
    return headers.get(name) || headers.get(name.toLowerCase());
  }
  const wanted = String(name).toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === wanted);
  return key ? headers[key] : undefined;
}

function splitSetCookie(value) {
  return String(value || "")
    .split(/,(?=\s*[^;,=\s]+=[^;,]*)/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function rememberCookies(headers, url) {
  if (new URL(url).hostname !== SITE_HOST) return;
  const raw = getHeader(headers, "set-cookie");
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  values.flatMap(splitSetCookie).forEach((item) => {
    const first = item.split(";", 1)[0];
    const index = first.indexOf("=");
    if (index <= 0) return;
    const name = first.slice(0, index).trim();
    const value = first.slice(index + 1).trim();
    if (name) cookieJar[name] = value;
  });
}

function currentCookie(url) {
  if (new URL(url).hostname !== SITE_HOST) return "";
  return Object.entries(cookieJar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function requestText(path, options = {}) {
  const url = absoluteUrl(path);
  let lastResponse = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cookie = currentCookie(url);
    const headers = {
      ...DEFAULT_HEADERS,
      ...(options.headers || {}),
      ...(cookie ? { Cookie: cookie } : {}),
    };

    const response = await OmniBox.request(url, {
      method: options.method || "GET",
      headers,
      timeout: options.timeout || 20000,
      ...(options.body !== undefined ? { body: options.body } : {}),
    });
    lastResponse = response;
    rememberCookies(response?.headers, url);

    const statusCode = Number(response?.statusCode || 0);
    if ((statusCode === 403 || statusCode === 429) && attempt === 0) {
      await delay(1100);
      continue;
    }
    if (statusCode !== 200) {
      throw new Error(`HTTP ${statusCode || "unknown"}: ${url}`);
    }
    return String(response?.body || "");
  }

  throw new Error(`HTTP ${lastResponse?.statusCode || "unknown"}: ${url}`);
}

function parseBooks(pageHtml) {
  const videos = [];
  const seen = new Set();
  const anchorPattern = /<a\s+href=["']\/book\/(\d+)\.html["'][^>]*>([\s\S]*?)<\/a>/gi;
  let anchorMatch;

  while ((anchorMatch = anchorPattern.exec(String(pageHtml || ""))) !== null) {
    const bookId = anchorMatch[1];
    const block = anchorMatch[2];
    const imageMatch = block.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (!imageMatch || seen.has(bookId)) continue;

    const titleMatch =
      block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) ||
      block.match(/<div class=["']font-medium text-sm[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const altMatch = block.match(/<img[^>]+alt=["']([^"']+)["']/i);
    const title = cleanText(titleMatch?.[1] || altMatch?.[1] || "");
    if (!title) continue;

    const speakerMatch =
      block.match(/>演播<\/span>\s*([^<\r\n]+)/i) ||
      block.match(/<div class=["']text-xs text-gray-500[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

    seen.add(bookId);
    videos.push({
      vod_id: bookId,
      vod_name: title,
      vod_pic: absoluteUrl(decodeHtml(imageMatch[1])),
      vod_remarks: cleanText(speakerMatch?.[1] || ""),
    });
  }

  return videos;
}

function field(pageHtml, label) {
  const pattern = new RegExp(
    `<p>\\s*${String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}：\\s*<span[^>]*>([\\s\\S]*?)<\\/span>`,
    "i",
  );
  return cleanText(String(pageHtml || "").match(pattern)?.[1] || "");
}

function firstText(pageHtml, pattern) {
  return cleanText(String(pageHtml || "").match(pattern)?.[1] || "");
}

function extractCover(pageHtml) {
  const html = String(pageHtml || "");
  const imageMatch =
    html.match(/<div class=["']w-32 h-44[\s\S]*?<img[^>]+src=["']([^"']+)/i) ||
    html.match(/<img[^>]+src=["']([^"']*\/uploads\/[^"']+)["']/i);
  if (!imageMatch) return "";
  const picture = absoluteUrl(decodeHtml(imageMatch[1]));
  return picture.includes("bookcover.png") ? "" : picture;
}

function bookIdFrom(value) {
  const text = String(value || "");
  return text.match(/\/book\/(\d+)\.html/i)?.[1] || text.match(/\d+/)?.[0] || "";
}

function bookReferer(playUrl) {
  const bookId = String(playUrl || "").match(/\/play\/(\d+)\//)?.[1];
  return bookId ? `${SITE}/book/${bookId}.html` : `${SITE}/`;
}

async function resolveLrts(token) {
  const parts = String(token || "").split("#");
  const entityMatch = parts[0]?.match(/^lrts\$(\d+)$/);
  if (!entityMatch || parts.length < 3 || !/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2])) {
    throw new Error("懒人听书资源标识格式错误");
  }

  const params = {
    entityId: entityMatch[1],
    entityType: 3,
    opType: 1,
    sections: `[${parts[2]}]`,
    type: 0,
    id: parts[1],
    section: parts[2],
  };
  let lastMessage = "";

  for (const endpoint of ["getPlayPath", "getListenPath"]) {
    const text = await requestText(
      buildUrl(`https://m.lrts.me/ajax/${endpoint}`, params),
      { headers: { Referer: "https://m.lrts.me/" } },
    );
    const payload = JSON.parse(text || "{}");
    const audioUrl = endpoint === "getPlayPath"
      ? payload?.list?.[0]?.path || ""
      : payload?.data?.path || "";
    if (Number(payload?.status) === 0 && /^https?:\/\//i.test(audioUrl)) {
      return audioUrl;
    }
    lastMessage = payload?.msg || lastMessage;
  }

  throw new Error(lastMessage || "懒人听书音频解析失败");
}

async function home() {
  try {
    const pageHtml = await requestText("/");
    return { class: CATEGORIES, list: parseBooks(pageHtml) };
  } catch (error) {
    log("error", `首页获取失败: ${error?.message || error}`);
    return { class: CATEGORIES, list: [] };
  }
}

async function category(params) {
  const categoryId = String(params?.categoryId || params?.typeId || params?.tid || "");
  const page = pageNumber(params?.page);
  const empty = { page, pagecount: 1, total: 0, limit: PAGE_LIMIT, list: [] };

  if (!CATEGORIES.some((item) => item.type_id === categoryId)) return empty;

  try {
    const pageHtml = categoryId === "latest"
      ? await requestText("/")
      : await requestText(buildUrl(`${SITE}/search.php`, {
          q: CATEGORY_QUERIES[categoryId] || categoryId,
        }));
    const list = parseBooks(pageHtml);
    return { page, pagecount: 1, total: list.length, limit: PAGE_LIMIT, list };
  } catch (error) {
    log("error", `分类获取失败 categoryId=${categoryId}: ${error?.message || error}`);
    return empty;
  }
}

async function search(params) {
  const keyword = String(params?.keyword || params?.wd || "").trim();
  const page = pageNumber(params?.page);
  const empty = { page, pagecount: 1, total: 0, limit: 50, list: [] };
  if (!keyword || page > 1) return empty;

  const cacheKey = `${keyword}\n${page}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 60000) return cached.result;

  try {
    const pageHtml = await requestText(buildUrl(`${SITE}/search.php`, { q: keyword }));
    const list = parseBooks(pageHtml);
    const totalMatch = pageHtml.match(/的结果\s*\((\d+)\)/);
    const result = {
      page,
      pagecount: 1,
      total: totalMatch ? Number(totalMatch[1]) : list.length,
      limit: 50,
      list,
    };
    searchCache.set(cacheKey, { cachedAt: Date.now(), result });
    return result;
  } catch (error) {
    log("error", `搜索失败 keyword=${keyword}: ${error?.message || error}`);
    return cached?.result || empty;
  }
}

async function detail(params) {
  const bookId = bookIdFrom(params?.videoId || params?.id || "");
  if (!bookId) return { list: [] };

  try {
    const pageHtml = await requestText(`/book/${bookId}.html`);
    const title = firstText(
      pageHtml,
      /<h1 class=["']text-2xl font-bold text-gray-800["']>([\s\S]*?)<\/h1>/i,
    );
    const picture = extractCover(pageHtml);
    const author = field(pageHtml, "作者");
    const speaker = field(pageHtml, "演播");
    const status = field(pageHtml, "状态");
    const count = pageHtml.match(/正文目录\s*\((\d+)\)/)?.[1] || "";
    const description = firstText(
      pageHtml,
      />作品简介<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/i,
    );

    const episodes = [];
    const chapterPattern =
      /href=["']\/play\/(\d+)\/(\d+)\.html["'][\s\S]*?<span class=["']text-sm text-gray-700 truncate["']>([\s\S]*?)<\/span>/gi;
    let chapterMatch;
    while ((chapterMatch = chapterPattern.exec(pageHtml)) !== null) {
      episodes.push({
        name: safeEpisodeName(cleanText(chapterMatch[3])),
        playId: `/play/${chapterMatch[1]}/${chapterMatch[2]}.html`,
      });
    }

    return {
      list: [
        {
          vod_id: bookId,
          vod_name: title || `书籍 ${bookId}`,
          vod_pic: picture || DEFAULT_COVER,
          type_name: "有声小说",
          vod_year: "",
          vod_area: "",
          vod_remarks: [status, count ? `${count}集` : ""].filter(Boolean).join(" · "),
          vod_actor: speaker,
          vod_director: author,
          vod_content: description,
          vod_play_sources: episodes.length
            ? [{ name: "275听书", episodes }]
            : [],
        },
      ],
    };
  } catch (error) {
    log("error", `详情获取失败 bookId=${bookId}: ${error?.message || error}`);
    return { list: [] };
  }
}

async function play(params) {
  const rawPlayId = String(params?.playId || params?.id || "").trim();
  const playUrl = absoluteUrl(rawPlayId).replace(
    /^http:\/\/www\.i275\.com/i,
    SITE,
  );
  let parsedPlayUrl;
  try {
    parsedPlayUrl = new URL(playUrl);
  } catch (_) {
    return { urls: [], parse: 1, header: {} };
  }
  if (
    !rawPlayId ||
    parsedPlayUrl.origin !== SITE ||
    !/^\/play\/\d+\/\d+\.html$/.test(parsedPlayUrl.pathname)
  ) {
    return { urls: [], parse: 1, header: {} };
  }

  try {
    if (!cookieJar.PHPSESSID) {
      await requestText("/");
      await delay(1050);
    }

    const pageHtml = await requestText(playUrl, {
      headers: { Referer: bookReferer(playUrl) },
    });
    const audioMatch = pageHtml.match(
      /\baudio\s*:\s*\[\s*\{[\s\S]*?\burl\s*:\s*["']([^"']+)["']/i,
    );
    if (!audioMatch) throw new Error("播放页没有音频地址");

    let audioUrl = decodeHtml(audioMatch[1]);
    let audioReferer = playUrl;
    if (audioUrl.startsWith("lrts$")) {
      audioUrl = await resolveLrts(audioUrl);
      audioReferer = "https://m.lrts.me/";
    }
    audioUrl = audioUrl.replace(/^http:\/\//i, "https://");
    if (!/^https:\/\//i.test(audioUrl)) {
      throw new Error("播放地址不是有效的 HTTPS 音频链接");
    }

    return {
      urls: [{ name: "275听书", url: audioUrl }],
      parse: 0,
      header: { "User-Agent": USER_AGENT, Referer: audioReferer },
    };
  } catch (error) {
    log("error", `播放解析失败 playId=${rawPlayId}: ${error?.message || error}`);
    const fallbackHeader = {
      "User-Agent": USER_AGENT,
      Referer: bookReferer(playUrl),
    };
    const cookie = currentCookie(playUrl);
    if (cookie) fallbackHeader.Cookie = cookie;
    return {
      urls: [{ name: "播放页", url: playUrl }],
      parse: 1,
      header: fallbackHeader,
    };
  }
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
