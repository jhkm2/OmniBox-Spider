// @name NO视频
// @description NO视频 - https://www.novipnoad.net/ 海外剧集电影采集站
// @dependencies cheerio
// @version 1.0.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/NO视频.js

const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

const HOST = "https://www.novipnoad.net";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";

const CATEGORIES = [
  { type_id: "movie", type_name: "电影", path: "/movie/" },
  { type_id: "tv-hongkong", type_name: "港剧", path: "/tv/hongkong/" },
  { type_id: "tv-taiwan", type_name: "台剧", path: "/tv/taiwan/" },
  { type_id: "tv-western", type_name: "欧美剧", path: "/tv/western/" },
  { type_id: "tv-japan", type_name: "日剧", path: "/tv/japan/" },
  { type_id: "tv-korea", type_name: "韩剧", path: "/tv/korea/" },
  { type_id: "tv-thailand", type_name: "泰剧", path: "/tv/thailand/" },
  { type_id: "tv-turkey", type_name: "土耳其剧", path: "/tv/turkey/" },
  { type_id: "anime", type_name: "动画", path: "/anime/" },
  { type_id: "shows", type_name: "综艺", path: "/shows/" },
  { type_id: "music", type_name: "音乐", path: "/music/" },
  { type_id: "short", type_name: "短片", path: "/short/" },
  { type_id: "other", type_name: "其他", path: "/other/" },
];

function absUrl(url = "") {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return "https:" + url;
  return HOST + (url.startsWith("/") ? url : `/${url}`);
}

function decodeHtml(text = "") {
  return String(text)
    .replace(/&#8211;/g, "-")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
}

async function logInfo(message) {
  await OmniBox.log("info", `[NO视频] ${message}`);
}

async function logError(message) {
  await OmniBox.log("error", `[NO视频] ${message}`);
}

async function requestHtml(url) {
  try {
    await logInfo(`请求 ${url}`);
    const res = await OmniBox.request(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Referer: HOST + "/",
      },
    });
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers && (res.headers.Location || res.headers.location)) {
      const redirected = absUrl(res.headers.Location || res.headers.location);
      await logInfo(`跟随跳转 ${redirected}`);
      return await requestHtml(redirected);
    }
    if (res.statusCode !== 200) {
      throw new Error(`HTTP ${res.statusCode}`);
    }
    return res.body || "";
  } catch (e) {
    await logError(`请求失败 ${url}: ${e.message}`);
    return "";
  }
}

function extractNumericId(url = "") {
  const match = String(url).match(/\/(\d+)\.html?$/i);
  return match ? match[1] : "";
}

function detectTypeFromUrl(url = "") {
  const clean = String(url);
  const cat = CATEGORIES.find((item) => clean.includes(item.path));
  return cat || null;
}

function parseCard($, el) {
  const root = $(el).closest(".video-item, article.post, .post, div[class*='video-item']");
  const anchor = root.find(".item-thumbnail a, h3 a, h2 a, a[href$='.html']").first();
  const href = absUrl(anchor.attr("href") || "");
  const title = decodeHtml(
    anchor.attr("title") ||
    root.find("h3 a, h2 a, h3, h2").first().text() ||
    root.text()
  );
  const img = absUrl(
    root.find("img[data-original]").first().attr("data-original") ||
    root.find("img[src]").first().attr("src") || ""
  );
  const cat = detectTypeFromUrl(href);
  const vodId = extractNumericId(href);
  if (!vodId || !title) return null;
  return {
    vod_id: vodId,
    vod_name: title,
    vod_pic: img,
    type_id: cat?.type_id || "",
    type_name: cat?.type_name || "",
    vod_remarks: "",
  };
}

function uniqueByVodId(list) {
  const seen = new Set();
  const result = [];
  for (const item of list) {
    if (!item || !item.vod_id || seen.has(item.vod_id)) continue;
    seen.add(item.vod_id);
    result.push(item);
  }
  return result;
}

async function fetchCategoryPage(category, page) {
  const base = absUrl(category.path);
  const url = page > 1 ? `${base}page/${page}/` : base;
  const html = await requestHtml(url);
  return { url, html };
}

async function resolveDetailPage(videoId) {
  const paths = CATEGORIES.map((item) => `${HOST}${item.path}${videoId}.html`);
  for (const url of paths) {
    const html = await requestHtml(url);
    if (html && !/未找到页面|404!|Page not found/i.test(html)) {
      return { url, html };
    }
  }
  return { url: "", html: "" };
}

async function sniffNoVideoPlay(playUrl) {
  try {
    if (!OmniBox.sniffVideo) return null;
    const sniffed = await OmniBox.sniffVideo(playUrl);
    if (sniffed && sniffed.url) {
      await logInfo(`嗅探成功 ${playUrl}`);
      return {
        urls: [{ name: "嗅探线路", url: sniffed.url }],
        parse: 0,
        header: sniffed.header || {
          Referer: playUrl,
          "User-Agent": UA,
        },
      };
    }
  } catch (e) {
    await logInfo(`嗅探失败 ${playUrl}: ${e.message}`);
  }
  return null;
}

function buildPlayId(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function parsePlayId(playId) {
  try {
    return JSON.parse(Buffer.from(String(playId || ""), "base64").toString("utf8"));
  } catch {
    return {};
  }
}

async function home(params, context) {
  try {
    const classList = CATEGORIES.map(({ type_id, type_name }) => ({ type_id, type_name }));
    const { html } = await fetchCategoryPage(CATEGORIES[0], 1);
    const $ = cheerio.load(html || "");
    const cards = [];
    $(".video-item, article.post, .post").each((_, el) => {
      const item = parseCard($, el);
      if (item) cards.push(item);
    });
    const list = uniqueByVodId(cards).slice(0, 20);
    await logInfo(`home 返回 ${list.length} 条`);
    return { class: classList, list };
  } catch (e) {
    await logError(`home 异常: ${e.message}`);
    return { class: CATEGORIES.map(({ type_id, type_name }) => ({ type_id, type_name })), list: [] };
  }
}

async function category(params, context) {
  try {
    const categoryId = String(params.categoryId || "movie");
    const page = Math.max(1, Number(params.page) || 1);
    const category = CATEGORIES.find((item) => item.type_id === categoryId) || CATEGORIES[0];
    const { html } = await fetchCategoryPage(category, page);
    const $ = cheerio.load(html || "");
    const cards = [];
    $(".video-item, article.post, .post").each((_, el) => {
      const item = parseCard($, el);
      if (item) {
        item.type_id = category.type_id;
        item.type_name = category.type_name;
        cards.push(item);
      }
    });
    const list = uniqueByVodId(cards);
    const hasNext = $("a[href*='/page/']").toArray().some((a) => {
      const href = $(a).attr("href") || "";
      return href.includes(`/page/${page + 1}/`);
    });
    await logInfo(`category ${categoryId} page=${page} 返回 ${list.length} 条`);
    return {
      page,
      pagecount: hasNext ? page + 1 : page,
      total: hasNext ? page * list.length + list.length : page * list.length,
      list,
    };
  } catch (e) {
    await logError(`category 异常: ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const videoId = String(params.videoId || "").trim();
    if (!videoId) return { list: [] };
    const { url, html } = await resolveDetailPage(videoId);
    if (!html) return { list: [] };
    const $ = cheerio.load(html);

    const finalDetailUrl = absUrl($("meta[property='og:url']").attr("content") || url);
    const title = decodeHtml($("h1.entry-title, h1").first().text());
    const pic = absUrl(
      $("meta[property='og:image']").attr("content") ||
      $("img[src*='upload'], img[data-original]").first().attr("src") ||
      $("img[data-original]").first().attr("data-original") || ""
    );
    const content = decodeHtml($(".item-content").first().text());
    const yearMatch = title.match(/(19|20)\d{2}/);
    const year = yearMatch ? yearMatch[0] : "";
    const cat = detectTypeFromUrl(finalDetailUrl);

    const playInfoMatch = html.match(/window\.playInfo\s*=\s*\{[\s\S]*?pkey\s*:\s*"([^"]+)"/i);
    const pkey = playInfoMatch ? playInfoMatch[1] : "";

    const episodes = [];
    $("a.multilink-btn[data-vid]").each((_, el) => {
      const btn = $(el);
      const vid = String(btn.attr("data-vid") || "").trim();
      const name = decodeHtml(btn.text().replace(/^\s+|\s+$/g, "")) || "在线播放";
      if (!vid || !pkey) return;
      episodes.push({
        name,
        playId: buildPlayId({ videoId, detailUrl: finalDetailUrl, vid, pkey, title }),
      });
    });

    if (!episodes.length) {
      const singlePlayInfoMatch = html.match(/window\.playInfo\s*=\s*\{\s*vid\s*:\s*"([^"]+)"\s*,\s*pkey\s*:\s*"([^"]+)"/i);
      const vid = singlePlayInfoMatch ? singlePlayInfoMatch[1] : "";
      const singlePkey = singlePlayInfoMatch ? singlePlayInfoMatch[2] : pkey;
      if (vid && singlePkey) {
        episodes.push({
          name: "在线播放",
          playId: buildPlayId({ videoId, detailUrl: finalDetailUrl, vid, pkey: singlePkey, title }),
        });
      }
    }

    const vod = {
      vod_id: videoId,
      vod_name: title,
      vod_pic: pic,
      vod_content: content,
      vod_year: year,
      type_id: cat?.type_id || "",
      type_name: cat?.type_name || "",
      vod_play_sources: episodes.length ? [{ name: "NO视频", episodes }] : [],
    };

    await logInfo(`detail ${videoId} episodes=${episodes.length}`);
    return { list: [vod] };
  } catch (e) {
    await logError(`detail 异常: ${e.message}`);
    return { list: [] };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params.keyword || "").trim();
    const page = Math.max(1, Number(params.page) || 1);
    if (!keyword) return { page: 1, pagecount: 0, total: 0, list: [] };

    const searchUrl = `${HOST}/search/${encodeURIComponent(keyword)}/`;
    const html = await requestHtml(searchUrl);
    const $ = cheerio.load(html || "");
    const cards = [];
    $(".video-item, article.post, .post").each((_, el) => {
      const item = parseCard($, el);
      if (item) cards.push(item);
    });
    const list = uniqueByVodId(cards);
    const hasNext = $("a[href*='/page/']").toArray().some((a) => {
      const href = $(a).attr("href") || "";
      return href.includes(`/page/${page + 1}/`);
    });
    await logInfo(`search ${keyword} 返回 ${list.length} 条`);
    return {
      page,
      pagecount: hasNext ? page + 1 : page,
      total: hasNext ? page * list.length + list.length : page * list.length,
      list,
    };
  } catch (e) {
    await logError(`search 异常: ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function play(params, context) {
  try {
    const meta = parsePlayId(params.playId || "");
    const vid = meta.vid || "";
    const pkey = meta.pkey || "";
    const detailUrl = meta.detailUrl || "";
    if (!vid || !pkey) {
      return { urls: [], parse: 1 };
    }

    const sniffUrl = detailUrl || `${HOST}/movie/${meta.videoId || ""}.html`;

    await logInfo(`play vid=${vid} sniffUrl=${sniffUrl}`);

    const sniffResult = await sniffNoVideoPlay(sniffUrl);
    if (sniffResult) {
      return sniffResult;
    }

    return {
      urls: [{ name: meta.title || "NO视频", url: sniffUrl }],
      parse: 1,
      header: {
        Referer: sniffUrl,
        "User-Agent": UA
      }};
  } catch (e) {
    await logError(`play 异常: ${e.message}`);
    return { urls: [], parse: 1 };
  }
}
