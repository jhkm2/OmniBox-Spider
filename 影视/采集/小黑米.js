// @name 小黑米
// @author 梦
// @description 影视站：https://xiaoheimi.cc/ ，支持首页、分类、详情、搜索与播放（直链提取）
// @dependencies cheerio
// @version 1.0.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/小黑米.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

const BASE_URL = (process.env.XIAOHEIMI_HOST || "https://xiaoheimi.cc").replace(/\/$/, "");
const UA = process.env.XIAOHEIMI_UA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const HOME_CACHE_TTL = Number(process.env.XIAOHEIMI_HOME_CACHE_TTL || 900);
const CATEGORY_CACHE_TTL = Number(process.env.XIAOHEIMI_CATEGORY_CACHE_TTL || 900);
const DETAIL_CACHE_TTL = Number(process.env.XIAOHEIMI_DETAIL_CACHE_TTL || 1800);
const SEARCH_CACHE_TTL = Number(process.env.XIAOHEIMI_SEARCH_CACHE_TTL || 600);
const PLAY_CACHE_TTL = Number(process.env.XIAOHEIMI_PLAY_CACHE_TTL || 1800);

const CLASS_LIST = [
  { type_id: "7", type_name: "电影" },
  { type_id: "6", type_name: "电视剧" },
  { type_id: "5", type_name: "动漫" },
  { type_id: "3", type_name: "综艺" },
  { type_id: "21", type_name: "纪录片" },
  { type_id: "64", type_name: "短剧" },
];

const FILTERS = Object.fromEntries(
  CLASS_LIST.map((item) => [
    item.type_id,
    [
      {
        key: "type",
        name: "分类",
        value: [{ name: "全部", value: item.type_id }],
      },
      {
        key: "by",
        name: "排序",
        value: [
          { name: "最新", value: "time" },
          { name: "人气", value: "hits" },
          { name: "评分", value: "score" },
        ],
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
  await OmniBox.log("info", `[小黑米][request] ${method} ${url}`);
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

function buildCard($, li) {
  const node = $(li);
  const anchor = node.find("a[href*='/vod/detail/id/']").first();
  const href = anchor.attr("href") || "";
  const title = cleanText(anchor.attr("title") || node.find(".title,.text-333,.myui-vodlist__title").first().text() || anchor.text());
  const img = node.find("img").first();
  const pic = pickAttr(anchor, ["data-original", "data-src", "src"]) || pickAttr(img, ["data-original", "data-src", "src"]);
  const remarks = cleanText(node.find(".pic-text,.text-right,.fed-list-remarks,.myui-vodlist__thumb .tag,.myui-vodlist__text,.module-item-note").first().text());
  return {
    vod_id: absUrl(href),
    vod_name: title,
    vod_pic: absUrl(pic),
    vod_remarks: remarks,
  };
}

function parseListFromHtml(html, options = {}) {
  const $ = cheerio.load(html);
  const list = [];
  const seenHref = new Set();
  const container = options.containerSelector ? $(options.containerSelector).first() : $.root();
  container.find("a[href*='/vod/detail/id/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href || seenHref.has(href)) return;
    seenHref.add(href);
    const cardNode = $(el).closest("li, .myui-vodlist__box, .myui-vodlist__item, .module-item, .public-list-box");
    const card = buildCard($, cardNode.length ? cardNode : el);
    if (card.vod_id && card.vod_name) list.push(card);
  });
  return uniqueBy(list, (item) => item.vod_id);
}

function parsePageCount($) {
  let pagecount = 1;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const matches = [...href.matchAll(/\/page\/(\d+)\.html/g)];
    for (const match of matches) {
      const num = Number(match[1] || 1);
      if (Number.isFinite(num)) pagecount = Math.max(pagecount, num);
    }
  });
  return pagecount;
}

function parseInfoList($) {
  const info = {};
  $("li.data, li").each((_, el) => {
    const text = cleanText($(el).text());
    if (!text) return;
    if (text.startsWith("地区：")) info.area = text.replace(/^地区：/, "").trim();
    if (text.startsWith("年份：")) info.year = text.replace(/^年份：/, "").trim();
    if (text.startsWith("主演：")) info.actor = text.replace(/^主演：/, "").trim();
    if (text.startsWith("导演：")) info.director = text.replace(/^导演：/, "").trim();
    if (text.startsWith("类型：")) info.type_name = text.replace(/^类型：/, "").trim();
    if (text.startsWith("更新：")) info.remarks = text.replace(/^更新：/, "").trim();
  });
  return info;
}

function dedupeEpisodes(episodes) {
  return uniqueBy(
    (Array.isArray(episodes) ? episodes : []).map((ep) => ({
      ...ep,
      name: cleanText(ep?.name || ""),
      playId: String(ep?.playId || "").trim(),
    })),
    (item) => `${item.name}|${item.playId}`
  ).filter((item) => item.name && item.playId);
}

function parseDetailSources($, detailUrl) {
  const sourceNames = {};
  $("a[data-toggle='tab'][href^='#playlist']").each((_, el) => {
    const target = ($(el).attr("href") || "").replace(/^#/, "");
    const name = cleanText($(el).text());
    if (target) sourceNames[target] = name || target;
  });

  const sources = [];
  $("div[id^='playlist']").each((_, box) => {
    const node = $(box);
    const playlistId = node.attr("id") || "";
    const sourceName = sourceNames[playlistId] || `线路${sources.length + 1}`;
    const episodes = [];
    node.find("a[href*='/vod/play/id/']").each((__, a) => {
      const href = $(a).attr("href") || "";
      const name = cleanText($(a).attr("title") || $(a).text());
      if (!href || !name) return;
      episodes.push({ name, playId: absUrl(href) });
    });
    const deduped = dedupeEpisodes(episodes);
    if (deduped.length) sources.push({ name: sourceName, episodes: deduped });
  });

  if (!sources.length && detailUrl) {
    sources.push({ name: "在线播放", episodes: [{ name: "立即播放", playId: String(detailUrl) }] });
  }
  return sources;
}

function parseDetail(html, detailUrl) {
  const $ = cheerio.load(html);
  const title = cleanText($("h1").first().text() || $("title").text().replace(/\s*-\s*小宝影院.*$/, ""));
  const poster = $(".myui-content__thumb img, .detail-pic img, .vod-detail-pic img, img.lazyload").first();
  const pic = absUrl(pickAttr(poster, ["data-original", "data-src", "src"]));
  const info = parseInfoList($);
  const desc = cleanText($(".desc,.data-more,.content,.vod_content,.tab-pane.active .content").first().html() || $("meta[name='description']").attr("content") || "");
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
  const match = html.match(/player_aaaa\s*=\s*(\{.*?\})\s*<\/script>/s) || html.match(/player_aaaa=(\{.*?\});/s);
  if (!match) throw new Error("未找到 player_aaaa 数据");
  const raw = match[1].replace(/\\\//g, "/");
  return JSON.parse(raw);
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
    await OmniBox.log("info", `[小黑米][home] from=${context?.from || "web"}`);
    const html = await getCachedText(`xiaoheimi:home`, HOME_CACHE_TTL, () => requestText(`${BASE_URL}/`));
    const list = parseListFromHtml(html).slice(0, 60);
    await OmniBox.log("info", `[小黑米][home] 推荐数量=${list.length}`);
    return { class: CLASS_LIST, filters: FILTERS, list };
  } catch (error) {
    await OmniBox.log("error", `[小黑米][home] 失败: ${error.message || error}`);
    return { class: CLASS_LIST, filters: FILTERS, list: [] };
  }
}

async function category(params, context) {
  try {
    const categoryId = String(params?.categoryId || "7");
    const page = Math.max(1, Number(params?.page || 1));
    const by = String(params?.filters?.by || "time").trim() || "time";
    const url = page > 1
      ? `${BASE_URL}/index.php/vod/show/by/${encodeURIComponent(by)}/id/${encodeURIComponent(categoryId)}/page/${page}.html`
      : `${BASE_URL}/index.php/vod/show/by/${encodeURIComponent(by)}/id/${encodeURIComponent(categoryId)}.html`;
    await OmniBox.log("info", `[小黑米][category] categoryId=${categoryId}, page=${page}, by=${by}`);
    const html = await getCachedText(`xiaoheimi:category:${categoryId}:${page}:${by}`, CATEGORY_CACHE_TTL, () => requestText(url));
    const $ = cheerio.load(html);
    const list = parseListFromHtml(html);
    const pagecount = parsePageCount($);
    await OmniBox.log("info", `[小黑米][category] 数量=${list.length}, pagecount=${pagecount}`);
    return {
      page,
      pagecount,
      total: pagecount > 1 ? pagecount * Math.max(list.length, 24) : list.length,
      list,
    };
  } catch (error) {
    await OmniBox.log("error", `[小黑米][category] 失败: ${error.message || error}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const videoId = String(params?.videoId || "").trim();
    if (!videoId) return { list: [] };
    await OmniBox.log("info", `[小黑米][detail] videoId=${videoId}`);
    const html = await getCachedText(`xiaoheimi:detail:${videoId}`, DETAIL_CACHE_TTL, () => requestText(videoId));
    const vod = parseDetail(html, videoId);
    await OmniBox.log("info", `[小黑米][detail] 线路数=${Array.isArray(vod.vod_play_sources) ? vod.vod_play_sources.length : 0}`);
    return { list: [vod] };
  } catch (error) {
    await OmniBox.log("error", `[小黑米][detail] 失败: ${error.message || error}`);
    return { list: [] };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params?.keyword || params?.wd || "").trim();
    const page = Math.max(1, Number(params?.page || 1));
    if (!keyword) return { page: 1, pagecount: 0, total: 0, list: [] };
    const url = page > 1
      ? `${BASE_URL}/index.php/vod/search/page/${page}/wd/${encodeURIComponent(keyword)}.html`
      : `${BASE_URL}/index.php/vod/search.html?wd=${encodeURIComponent(keyword)}`;
    await OmniBox.log("info", `[小黑米][search] keyword=${keyword}, page=${page}`);
    const html = await getCachedText(`xiaoheimi:search:${keyword}:${page}`, SEARCH_CACHE_TTL, () => requestText(url));
    const $ = cheerio.load(html);
    const list = parseListFromHtml(html, { containerSelector: "#searchList" });
    const pagecount = parsePageCount($);
    await OmniBox.log("info", `[小黑米][search] 数量=${list.length}, pagecount=${pagecount}`);
    return {
      page,
      pagecount,
      total: pagecount > 1 ? pagecount * Math.max(list.length, 20) : list.length,
      list,
    };
  } catch (error) {
    await OmniBox.log("error", `[小黑米][search] 失败: ${error.message || error}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function play(params, context) {
  try {
    const playId = String(params?.playId || "").trim();
    const flag = String(params?.flag || "play").trim() || "play";
    if (!playId) throw new Error("playId 不能为空");
    await OmniBox.log("info", `[小黑米][play] playId=${playId}, flag=${flag}`);
    const html = await getCachedText(`xiaoheimi:play:${playId}`, PLAY_CACHE_TTL, () => requestText(playId, { referer: playId }));
    const player = extractPlayerData(html);
    const realUrl = decodePlayerUrl(player?.url, player?.encrypt);
    if (!realUrl) throw new Error("未提取到播放地址");
    await OmniBox.log("info", `[小黑米][play] from=${player?.from || "unknown"}, encrypt=${player?.encrypt || 0}`);
    return {
      urls: [{ name: "播放", url: realUrl }],
      header: {
        Referer: `${BASE_URL}/`,
        "User-Agent": UA
      },
      parse: /\.(m3u8|mp4)(\?|$)/i.test(realUrl) ? 0 : 1};
  } catch (error) {
    await OmniBox.log("error", `[小黑米][play] 失败: ${error.message || error}`);
    return { urls: [], header: {}, parse: 1 };
  }
}
