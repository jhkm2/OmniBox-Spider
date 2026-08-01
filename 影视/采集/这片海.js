// @name 这片海
// @author 梦
// @description 影视站：https://www.zhepianhai.com/ ，支持首页、分类、详情、搜索与播放（直链提取）
// @dependencies cheerio
// @version 1.0.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/这片海.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

const BASE_URL = (process.env.ZHEPIANHAI_HOST || "https://www.zhepianhai.com").replace(/\/$/, "");
const UA = process.env.ZHEPIANHAI_UA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const HOME_CACHE_TTL = Number(process.env.ZHEPIANHAI_HOME_CACHE_TTL || 900);
const CATEGORY_CACHE_TTL = Number(process.env.ZHEPIANHAI_CATEGORY_CACHE_TTL || 900);
const DETAIL_CACHE_TTL = Number(process.env.ZHEPIANHAI_DETAIL_CACHE_TTL || 1800);
const SEARCH_CACHE_TTL = Number(process.env.ZHEPIANHAI_SEARCH_CACHE_TTL || 600);
const PLAY_CACHE_TTL = Number(process.env.ZHEPIANHAI_PLAY_CACHE_TTL || 1800);

const CLASS_LIST = [
  { type_id: "1", type_name: "电视剧" },
  { type_id: "2", type_name: "动漫" },
  { type_id: "3", type_name: "综艺" },
];

const FILTERS = Object.fromEntries(
  CLASS_LIST.map((item) => [
    item.type_id,
    [
      {
        key: "categoryId",
        name: "分类",
        value: [{ name: "全部", value: item.type_id }],
      },
    ],
  ])
);

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function absUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  try {
    return new URL(raw, `${BASE_URL}/`).toString();
  } catch (_) {
    return raw;
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function uniqueBy(list, keyFn) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function pickAttr(node, names) {
  for (const name of names) {
    const value = node.attr(name);
    if (value) return value;
  }
  return "";
}

async function requestText(url, options = {}) {
  const method = options.method || "GET";
  await OmniBox.log("info", `[这片海][request] ${method} ${url}`);
  const res = await OmniBox.request(url, {
    method,
    headers: {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: options.referer || `${BASE_URL}/`,
      ...(options.headers || {}),
    },
    body: options.body,
    timeout: options.timeout || 20000,
  });
  const statusCode = Number(res?.statusCode || 0);
  const body = typeof res?.body === "string" ? res.body : String(res?.body || "");
  if (statusCode !== 200) {
    throw new Error(`HTTP ${statusCode || "unknown"} @ ${url}`);
  }
  return body;
}

async function getCachedText(cacheKey, ttl, producer) {
  try {
    const cached = await OmniBox.getCache(cacheKey);
    if (cached) return String(cached);
  } catch (_) {}
  const text = String(await producer());
  try {
    await OmniBox.setCache(cacheKey, text, ttl);
  } catch (_) {}
  return text;
}

function buildCard($, node) {
  const item = $(node);
  const anchor = item.find("a[href*='/intro/']").first();
  const href = anchor.attr("href") || "";
  const title = cleanText(
    anchor.attr("title") ||
      item.find("h3 a, strong a").first().attr("title") ||
      item.find("h3 a, strong a").first().text() ||
      anchor.text()
  );
  const img = item.find("img").first();
  const pic = pickAttr(anchor, ["data-original", "data-src", "src"]) || pickAttr(img, ["data-original", "data-src", "src"]);
  const remarks = cleanText(
    item.find(".bottom2,.tag,.ss1,.otherbox em,.bottom span:last-child").first().text() ||
      item.find("span[class*='bottom']").last().text()
  );
  return {
    vod_id: absUrl(href),
    vod_name: title.replace(/\s*\(\d{4}\)\s*$/, ""),
    vod_pic: absUrl(pic),
    vod_remarks: remarks.replace(/^\[|\]$/g, ""),
  };
}

function parseListFromHtml(html, options = {}) {
  const $ = cheerio.load(html);
  const list = [];
  const container = options.containerSelector ? $(options.containerSelector).first() : $.root();
  const selectors = options.itemSelector || ".indexShowBox li, ul.content-list li, ul.content-list2 li, .sr_lists dl";
  container.find(selectors).each((_, el) => {
    const card = buildCard($, el);
    if (card.vod_id && card.vod_name) list.push(card);
  });
  return uniqueBy(list, (item) => item.vod_id);
}

function parsePageCount($) {
  let pagecount = 1;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const matches = [...href.matchAll(/\/(?:class\/\d+\-|query\/page\/)(\d+)(?:\/|\.html)/g)];
    for (const match of matches) {
      const num = Number(match[1] || 1);
      if (Number.isFinite(num)) pagecount = Math.max(pagecount, num);
    }
  });
  return pagecount;
}

function parseInfoFromDetail($) {
  const info = {};
  $(".main-ui-meta > div, .main-ui-meta p").each((_, el) => {
    const text = cleanText($(el).text());
    if (!text) return;
    if (/^导演：/.test(text)) info.director = text.replace(/^导演：/, "").trim();
    if (/^主演：/.test(text)) info.actor = text.replace(/^主演：/, "").trim();
    if (/^地区：/.test(text)) info.area = text.replace(/^地区：/, "").trim();
    if (/^类型：/.test(text)) info.type_name = text.replace(/^类型：/, "").trim();
    if (/^语言：/.test(text)) info.lang = text.replace(/^语言：/, "").trim();
    if (/^上映：/.test(text)) info.year = text.replace(/^上映：/, "").trim();
  });

  const yearText = cleanText($(".main-ui-meta h1 .year").first().text()).replace(/[()（）]/g, "");
  if (yearText && !info.year) info.year = yearText;

  const remarks = cleanText($(".otherbox em").first().text() || $(".otherbox").first().text());
  if (remarks) info.remarks = remarks;
  return info;
}

function parseDetailSources($, detailUrl) {
  const tabNames = $(".py-tabs li")
    .map((_, el) => cleanText($(el).text()))
    .get()
    .filter(Boolean);

  const sources = [];
  $("#url .bd ul.player").each((idx, box) => {
    const episodes = [];
    $(box)
      .find("a[href*='/dplay/']")
      .each((__, a) => {
        const href = $(a).attr("href") || "";
        const name = cleanText($(a).attr("title") || $(a).text());
        if (!href || !name) return;
        episodes.push({ name, playId: absUrl(href) });
      });
    const deduped = uniqueBy(episodes, (item) => `${item.name}|${item.playId}`);
    if (deduped.length) {
      sources.push({
        name: tabNames[idx] || `线路${idx + 1}`,
        episodes: deduped,
      });
    }
  });

  if (!sources.length && detailUrl) {
    sources.push({ name: "在线播放", episodes: [{ name: "立即播放", playId: String(detailUrl) }] });
  }
  return sources;
}

function parseDetail(html, detailUrl) {
  const $ = cheerio.load(html);
  const title = cleanText($(".main-ui-meta h1").first().clone().find(".year").remove().end().text() || $("title").text().replace(/\s*_.*$/, ""));
  const poster = $(".main-left-1 .img img, .img img").first();
  const pic = absUrl(pickAttr(poster, ["data-original", "data-src", "src"]));
  const info = parseInfoFromDetail($);
  const desc = cleanText($(".tab-jq p").first().html() || $("meta[name='description']").attr("content") || "");
  const vod_play_sources = parseDetailSources($, detailUrl);

  return {
    vod_id: detailUrl,
    vod_name: title,
    vod_pic: pic,
    vod_remarks: info.remarks || "",
    vod_year: info.year || "",
    vod_area: info.area || "",
    vod_actor: info.actor || "",
    vod_director: info.director || "",
    type_name: info.type_name || "",
    vod_content: desc,
    vod_play_sources,
  };
}

function extractPlayerData(html) {
  const match = html.match(/var\s+player_aaaa\s*=\s*(\{.*?\})\s*;/s) || html.match(/player_aaaa\s*=\s*(\{.*?\})\s*<\/script>/s);
  if (!match) throw new Error("未找到 player_aaaa 数据");
  return JSON.parse(match[1].replace(/\\\//g, "/"));
}

function decodePlayerUrl(url, encrypt) {
  const raw = String(url || "").trim();
  const mode = Number(encrypt || 0);
  if (!raw) return "";
  try {
    if (mode === 1) return unescape(raw);
    if (mode === 2) return unescape(Buffer.from(raw, "base64").toString("utf8"));
  } catch (_) {}
  return raw;
}

async function home(params, context) {
  try {
    await OmniBox.log("info", `[这片海][home] from=${context?.from || "web"}`);
    const html = await getCachedText("zhepianhai:home", HOME_CACHE_TTL, () => requestText(`${BASE_URL}/`));
    const list = parseListFromHtml(html).slice(0, 60);
    await OmniBox.log("info", `[这片海][home] 推荐数量=${list.length}`);
    return { class: CLASS_LIST, filters: FILTERS, list };
  } catch (error) {
    await OmniBox.log("error", `[这片海][home] 失败: ${error.message || error}`);
    return { class: CLASS_LIST, filters: FILTERS, list: [] };
  }
}

async function category(params, context) {
  try {
    const categoryId = String(params?.categoryId || "1");
    const page = Math.max(1, Number(params?.page || 1));
    const url = page > 1 ? `${BASE_URL}/class/${encodeURIComponent(categoryId)}-${page}.html` : `${BASE_URL}/class/${encodeURIComponent(categoryId)}.html`;
    await OmniBox.log("info", `[这片海][category] categoryId=${categoryId}, page=${page}`);
    const html = await getCachedText(`zhepianhai:category:${categoryId}:${page}`, CATEGORY_CACHE_TTL, () => requestText(url));
    const $ = cheerio.load(html);
    const list = parseListFromHtml(html, { itemSelector: "ul.content-list li" });
    const pagecount = parsePageCount($);
    await OmniBox.log("info", `[这片海][category] 数量=${list.length}, pagecount=${pagecount}`);
    return {
      page,
      pagecount,
      total: pagecount > 1 ? pagecount * Math.max(list.length, 24) : list.length,
      list,
    };
  } catch (error) {
    await OmniBox.log("error", `[这片海][category] 失败: ${error.message || error}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const videoId = String(params?.videoId || "").trim();
    if (!videoId) return { list: [] };
    await OmniBox.log("info", `[这片海][detail] videoId=${videoId}`);
    const html = await getCachedText(`zhepianhai:detail:${videoId}`, DETAIL_CACHE_TTL, () => requestText(videoId));
    const vod = parseDetail(html, videoId);
    await OmniBox.log("info", `[这片海][detail] 线路数=${Array.isArray(vod.vod_play_sources) ? vod.vod_play_sources.length : 0}`);
    return { list: [vod] };
  } catch (error) {
    await OmniBox.log("error", `[这片海][detail] 失败: ${error.message || error}`);
    return { list: [] };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params?.keyword || params?.wd || "").trim();
    const page = Math.max(1, Number(params?.page || 1));
    if (!keyword) return { page: 1, pagecount: 0, total: 0, list: [] };
    const url = page > 1
      ? `${BASE_URL}/query/page/${page}/wd/${encodeURIComponent(keyword)}.html`
      : `${BASE_URL}/query.html?wd=${encodeURIComponent(keyword)}`;
    await OmniBox.log("info", `[这片海][search] keyword=${keyword}, page=${page}`);
    const html = await getCachedText(`zhepianhai:search:${keyword}:${page}`, SEARCH_CACHE_TTL, () => requestText(url));
    const $ = cheerio.load(html);
    const list = parseListFromHtml(html, { containerSelector: ".sr_lists", itemSelector: "dl" });
    const pagecount = parsePageCount($);
    await OmniBox.log("info", `[这片海][search] 数量=${list.length}, pagecount=${pagecount}`);
    return {
      page,
      pagecount,
      total: pagecount > 1 ? pagecount * Math.max(list.length, 20) : list.length,
      list,
    };
  } catch (error) {
    await OmniBox.log("error", `[这片海][search] 失败: ${error.message || error}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function play(params, context) {
  try {
    const playId = String(params?.playId || "").trim();
    const flag = String(params?.flag || "play").trim() || "play";
    if (!playId) throw new Error("playId 不能为空");
    await OmniBox.log("info", `[这片海][play] playId=${playId}, flag=${flag}`);
    const html = await getCachedText(`zhepianhai:play:${playId}`, PLAY_CACHE_TTL, () => requestText(playId, { referer: playId }));
    const player = extractPlayerData(html);
    const realUrl = decodePlayerUrl(player?.url, player?.encrypt);
    if (!realUrl) throw new Error("未提取到播放地址");
    await OmniBox.log("info", `[这片海][play] from=${player?.from || "unknown"}, encrypt=${player?.encrypt || 0}`);
    return {
      urls: [{ name: "播放", url: realUrl }],
      header: {
        Referer: `${BASE_URL}/`,
        "User-Agent": UA
      },
      parse: /\.(m3u8|mp4)(\?|$)/i.test(realUrl) ? 0 : 1};
  } catch (error) {
    await OmniBox.log("error", `[这片海][play] 失败: ${error.message || error}`);
    return { urls: [], header: {}, parse: 1 };
  }
}
