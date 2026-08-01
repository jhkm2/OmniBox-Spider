// @name 剧圈圈
// @author 梦
// @description 影视站：支持首页、分类、详情、搜索与播放
// @dependencies cheerio
// @version 1.0.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/剧圈圈.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

const BASE_URL = "https://www.jqqzx.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const LIST_CACHE_TTL = Number(process.env.JQQ_LIST_CACHE_TTL || 900);
const DETAIL_CACHE_TTL = Number(process.env.JQQ_DETAIL_CACHE_TTL || 1800);
const SEARCH_CACHE_TTL = Number(process.env.JQQ_SEARCH_CACHE_TTL || 600);

const CATEGORY_CONFIG = [
  { id: "dianying", name: "电影" },
  { id: "juji", name: "剧集" },
  { id: "dongman", name: "动漫" },
  { id: "zongyi", name: "综艺" },
  { id: "duanju", name: "短剧" },
];

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

async function requestText(url, options = {}) {
  const res = await requestWithResponse(url, options);
  return String(res.body || "");
}

async function requestWithResponse(url, options = {}) {
  await OmniBox.log("info", `[剧圈圈][request] ${options.method || "GET"} ${url}`);
  const res = await OmniBox.request(url, {
    method: options.method || "GET",
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
  if (!res || statusCode !== 200) {
    throw new Error(`HTTP ${res?.statusCode || "unknown"} @ ${url}`);
  }
  return {
    body: String(res.body || ""),
    headers: res.headers || {},
    statusCode,
  };
}

async function requestTextNative(url, options = {}) {
  await OmniBox.log("info", `[剧圈圈][native-request] ${options.method || "GET"} ${url}`);
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    const body = options.body == null ? "" : String(options.body);
    const headers = {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: options.referer || `${BASE_URL}/`,
      ...(options.headers || {}),
    };
    if (body && headers["Content-Length"] == null && headers["content-length"] == null) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const transport = requestUrl.protocol === "http:" ? http : https;
    const req = transport.request({
      protocol: requestUrl.protocol,
      hostname: requestUrl.hostname,
      port: requestUrl.port || (requestUrl.protocol === "http:" ? 80 : 443),
      path: `${requestUrl.pathname}${requestUrl.search}`,
      method: options.method || "GET",
      headers,
      timeout: options.timeout || 20000,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        const statusCode = Number(res.statusCode || 0);
        if (statusCode !== 200) {
          reject(new Error(`HTTP ${statusCode} @ ${url}`));
          return;
        }
        resolve({
          body: String(data || ""),
          headers: res.headers || {},
          statusCode,
        });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`timeout @ ${url}`));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function getSetCookies(headers = {}) {
  const setCookie = headers["set-cookie"] || headers["Set-Cookie"] || headers["SET-COOKIE"] || [];
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  return list.map((item) => String(item || "").split(";")[0]).filter(Boolean);
}

function mergeCookies(...groups) {
  const store = {};
  for (const group of groups) {
    const items = Array.isArray(group) ? group : [group];
    for (const item of items) {
      const raw = String(item || "").trim();
      const idx = raw.indexOf("=");
      if (idx <= 0) continue;
      store[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
    }
  }
  return Object.entries(store).map(([k, v]) => `${k}=${v}`);
}

async function getCachedText(cacheKey, ttl, producer) {
  try {
    const cached = await OmniBox.getCache(cacheKey);
    if (cached) return String(cached);
  } catch (_) {}
  const value = String(await producer());
  try {
    await OmniBox.setCache(cacheKey, value, ttl);
  } catch (_) {}
  return value;
}

function absoluteUrl(url) {
  try {
    return new URL(String(url || ""), BASE_URL).toString();
  } catch (_) {
    return String(url || "");
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanDisplayText(value) {
  return normalizeText(
    String(value || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#160;/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function categoryNameById(categoryId) {
  return CATEGORY_CONFIG.find((item) => item.id === String(categoryId))?.name || "影视";
}

function mapListItem($, el) {
  const node = $(el);
  const href = node.attr("href") || node.find("a[href]").first().attr("href") || "";
  const name = cleanDisplayText(
    node.find(".module-poster-item-title").first().text()
    || node.attr("title")
    || node.find("img").first().attr("alt")
    || "",
  );
  const pic = node.find("img").first().attr("data-original") || node.find("img").first().attr("src") || "";
  const remarks = cleanDisplayText(node.find(".module-item-note").first().text());
  return {
    vod_id: absoluteUrl(href),
    vod_name: name,
    vod_pic: absoluteUrl(pic),
    vod_remarks: remarks,
  };
}

function parseList(htmlText) {
  const $ = cheerio.load(htmlText);
  const list = [];
  const seen = new Set();
  $("a.module-poster-item.module-item").each((_, el) => {
    const item = mapListItem($, el);
    if (!item.vod_id || !item.vod_name || seen.has(item.vod_id)) return;
    seen.add(item.vod_id);
    list.push(item);
  });
  return list;
}

function parseSearchList(jsonText) {
  let data = null;
  try {
    data = JSON.parse(String(jsonText || "{}"));
  } catch (_) {
    return [];
  }
  const list = Array.isArray(data?.list) ? data.list : [];
  return list.map((item) => ({
    vod_id: absoluteUrl(`/vod/${item.id}.html`),
    vod_name: cleanDisplayText(item.name || ""),
    vod_pic: absoluteUrl(item.pic || ""),
    vod_remarks: "",
  })).filter((item) => item.vod_id && item.vod_name);
}

function parseInfoItems($) {
  const info = {};
  $(".module-info-item").each((_, el) => {
    const title = cleanDisplayText($(el).find(".module-info-item-title").first().text()).replace(/[：:]$/, "");
    if (!title) return;
    const contentLinks = $(el).find(".module-info-item-content a").toArray().map((a) => cleanDisplayText($(a).text())).filter(Boolean);
    const content = contentLinks.length
      ? contentLinks.join(" / ")
      : cleanDisplayText($(el).find(".module-info-item-content").first().html() || $(el).text()).replace(new RegExp(`^${title}\s*[：:]?\s*`), "");
    info[title] = content;
  });
  return info;
}

function parseDetail(htmlText, detailUrl) {
  const $ = cheerio.load(htmlText);
  const title = cleanDisplayText($(".module-info-heading h1").first().text());
  const pic = absoluteUrl($(".module-item-pic img, .module-info-poster img").first().attr("data-original") || $(".module-item-pic img, .module-info-poster img").first().attr("src") || "");
  const content = cleanDisplayText($(".module-info-introduction-content").first().html() || $(".module-info-introduction-content").first().text());
  const tags = $(".module-info-tag-link a").toArray().map((el) => cleanDisplayText($(el).text())).filter(Boolean);
  const infoData = parseInfoItems($);

  const tabNames = [];
  $("#y-playList .module-tab-item").each((_, el) => {
    const name = cleanDisplayText($(el).attr("data-dropdown-value") || $(el).find("span").first().text());
    if (name) tabNames.push(name);
  });

  const playSources = [];
  $(".his-tab-list").each((idx, box) => {
    const sourceName = tabNames[idx] || `线路${idx + 1}`;
    const episodes = [];
    $(box).find("a.module-play-list-link[href]").each((__, a) => {
      const href = $(a).attr("href") || "";
      const epName = cleanDisplayText($(a).find("span").first().text() || $(a).text());
      if (!href || !epName) return;
      episodes.push({ name: epName, playId: absoluteUrl(href) });
    });
    if (episodes.length) playSources.push({ name: sourceName, episodes });
  });

  return {
    list: [{
      vod_id: detailUrl,
      vod_name: title,
      vod_pic: pic,
      type_name: tags.join(" / "),
      vod_remarks: cleanDisplayText(infoData["备注"] || infoData["状态"] || ""),
      vod_actor: cleanDisplayText(infoData["主演"] || ""),
      vod_director: cleanDisplayText(infoData["导演"] || ""),
      vod_content: content,
      vod_play_sources: playSources,
    }],
  };
}

function base64Decode(str) {
  const safe = String(str || "").replace(/[\r\n\s]/g, "");
  if (!safe) return "";
  const padded = safe + "=".repeat((4 - (safe.length % 4)) % 4);
  try {
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch (_) {
    return "";
  }
}

function md5Hex(input) {
  return crypto.createHash("md5").update(String(input || "")).digest("hex");
}

function xorDecode(encoded) {
  const key = md5Hex("test");
  const txt = base64Decode(encoded);
  let out = "";
  for (let i = 0; i < txt.length; i += 1) {
    out += String.fromCharCode(txt.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return base64Decode(out);
}

function decodeUrl(enc) {
  const value = String(enc || "").replace(/^error:\/\/apiRes_/, "").trim();
  if (!value) return "";
  try {
    const decoded = xorDecode(value);
    const parts = String(decoded || "").split("/");
    if (parts.length < 3) return "";
    const from = JSON.parse(base64Decode(parts[1]));
    const to = JSON.parse(base64Decode(parts[0]));
    const body = base64Decode(parts.slice(2).join("/"));
    const mapped = String(body || "").replace(/[a-zA-Z]/g, (s) => {
      const i = Array.isArray(from) ? from.indexOf(s) : -1;
      return i > -1 && Array.isArray(to) && to[i] ? to[i] : s;
    }).trim();
    const matchedUrl = mapped.match(/https?:\/\/[^\s'"<>]+/i);
    return matchedUrl ? matchedUrl[0] : mapped;
  } catch (_) {
    return "";
  }
}

function extractPlayerData(htmlText) {
  const html = String(htmlText || "");
  const match = html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch (_) {
    return null;
  }
}

async function home() {
  try {
    const html = await getCachedText("jqq:home", LIST_CACHE_TTL, () => requestText(`${BASE_URL}/`));
    const list = parseList(html).slice(0, 40);
    await OmniBox.log("info", `[剧圈圈][home] list=${list.length}`);
    return {
      class: CATEGORY_CONFIG.map((item) => ({ type_id: item.id, type_name: item.name })),
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[剧圈圈][home] ${e.message}`);
    return { class: CATEGORY_CONFIG.map((item) => ({ type_id: item.id, type_name: item.name })), list: [] };
  }
}

async function category(params = {}) {
  try {
    const categoryId = String(params.categoryId || params.type_id || params.id || "dianying");
    const page = Math.max(1, Number(params.page) || 1);
    const url = `${BASE_URL}/type/${categoryId}/page/${page}.html`;
    const html = await getCachedText(`jqq:category:${categoryId}:${page}`, LIST_CACHE_TTL, () => requestText(url));
    const list = parseList(html).map((item) => ({ ...item, type_name: categoryNameById(categoryId) }));
    await OmniBox.log("info", `[剧圈圈][category] category=${categoryId} page=${page} count=${list.length}`);
    return {
      page,
      pagecount: list.length ? page + 1 : page,
      total: page * list.length + (list.length ? 1 : 0),
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[剧圈圈][category] ${e.message}`);
    return { page: Number(params.page) || 1, pagecount: Number(params.page) || 1, total: 0, list: [] };
  }
}

async function detail(params = {}) {
  try {
    const videoId = absoluteUrl(params.videoId || params.id || params.vod_id || "");
    if (!videoId) return { list: [] };
    const html = await getCachedText(`jqq:detail:${videoId}`, DETAIL_CACHE_TTL, () => requestText(videoId));
    const result = parseDetail(html, videoId);
    await OmniBox.log("info", `[剧圈圈][detail] id=${videoId} sources=${result.list?.[0]?.vod_play_sources?.length || 0}`);
    return result;
  } catch (e) {
    await OmniBox.log("error", `[剧圈圈][detail] ${e.message}`);
    return { list: [] };
  }
}

async function search(params = {}) {
  try {
    const wd = normalizeText(params.wd || params.keyword || params.key || "");
    const page = Math.max(1, Number(params.page) || 1);
    if (!wd) return { list: [] };
    const url = `${BASE_URL}/index.php/ajax/suggest?mid=1&wd=${encodeURIComponent(wd)}`;
    const jsonText = await getCachedText(`jqq:search:${wd}:${page}`, SEARCH_CACHE_TTL, () => requestText(url));
    const list = parseSearchList(jsonText);
    await OmniBox.log("info", `[剧圈圈][search] wd=${wd} count=${list.length}`);
    return {
      page,
      pagecount: 1,
      total: list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("warn", `[剧圈圈][search] ${e.message}`);
    return { page: 1, pagecount: 1, total: 0, list: [] };
  }
}

async function play(params = {}, context = {}) {
  try {
    const playId = absoluteUrl(params.id || params.playId || "");
    if (!playId) return { parse: 1, url: "", urls: [], header: {} };

    const playPageRes = await requestTextNative(playId, { referer: `${BASE_URL}/` });
    const html = playPageRes.body || "";
    let cookies = getSetCookies(playPageRes.headers);
    const player = extractPlayerData(html);
    const vid = decodeURIComponent(String(player?.url || "")).trim();
    await OmniBox.log("info", `[剧圈圈][play] playId=${playId} vid=${vid.slice(0, 160)} cookieCount=${cookies.length}`);

    if (!vid) {
      return {
        parse: 1,
        url: playId,
        urls: [{ name: "播放页", url: playId }],
        header: { "User-Agent": UA, Referer: `${BASE_URL}/` },
        headers: { "User-Agent": UA, Referer: `${BASE_URL}/` }};
    }

    if (/^https?:\/\/.*\.(m3u8|mp4|flv|m4s)(\?.*)?$/i.test(vid)) {
      const directHeaders = { "User-Agent": UA, Referer: playId };
      return {
        parse: 0,
        url: vid,
        urls: [{ name: "播放", url: vid }],
        header: directHeaders,
        headers: directHeaders};
    }

    const playerUrl = `${BASE_URL}/jx/player.php?vid=${encodeURIComponent(vid)}`;
    const playerRes = await requestTextNative(playerUrl, {
      referer: playId,
      headers: cookies.length ? { Cookie: cookies.join("; ") } : {},
    });
    cookies = mergeCookies(cookies, getSetCookies(playerRes.headers));
    const apiBody = `vid=${encodeURIComponent(vid)}`;
    const apiRes = await requestTextNative(`${BASE_URL}/jx/api.php`, {
      method: "POST",
      referer: playerUrl,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Origin: BASE_URL,
        Referer: playerUrl,
        Accept: "*/*",
        ...(cookies.length ? { Cookie: cookies.join("; ") } : {}),
      },
      body: apiBody,
    });
    const apiRaw = String(apiRes?.body || "");

    let apiJson = null;
    try {
      apiJson = JSON.parse(apiRaw);
    } catch (parseError) {
      await OmniBox.log("warn", `[剧圈圈][play] api parse failed: ${parseError.message}`);
    }

    const rawDataUrl = String(apiJson?.data?.url || "");
    const realUrl = apiJson?.code === 200 && rawDataUrl ? decodeUrl(rawDataUrl) : "";
    await OmniBox.log("info", `[剧圈圈][play] api code=${apiJson?.code ?? ""} player=${apiJson?.data?.player || ""} type=${apiJson?.data?.type || ""} rawLen=${rawDataUrl.length} realLen=${String(realUrl || "").length} raw=${rawDataUrl.slice(0, 160)} realUrl=${String(realUrl || "").slice(0, 200)}`);

    if (/^https?:\/\//i.test(realUrl)) {
      const finalHeaders = { "User-Agent": UA, Referer: playerUrl };
      return {
        parse: 0,
        url: realUrl,
        urls: [{ name: "播放", url: realUrl }],
        header: finalHeaders,
        headers: finalHeaders};
    }

    return {
      parse: 1,
      url: playId,
      urls: [{ name: "播放页", url: playId }],
      header: { "User-Agent": UA, Referer: playerUrl },
      headers: { "User-Agent": UA, Referer: playerUrl }};
  } catch (e) {
    await OmniBox.log("error", `[剧圈圈][play] ${e.message}`);
    return { parse: 1, url: "", urls: [], header: {} };
  }
}
