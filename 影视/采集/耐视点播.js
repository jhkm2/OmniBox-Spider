// @name 耐视点播
// @author 梦
// @description 页面解析：https://nsvod.me，支持首页、分类、搜索、详情与播放页解析
// @version 1.0.3
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/耐视点播.js
// @dependencies cheerio

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

const BASE_URL = "https://nsvod.me";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, Referer: `${BASE_URL}/` };

const CLASS_LIST = [
  { type_id: "1", type_name: "电影" },
  { type_id: "2", type_name: "连续剧" },
  { type_id: "3", type_name: "综艺" },
  { type_id: "4", type_name: "动漫" },
  { type_id: "37", type_name: "Netflix" },
  { type_id: "40", type_name: "纪录片" },
];

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function getBodyText(res) {
  const body = res && typeof res === "object" && "body" in res ? res.body : res;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.toString();
  return String(body || "");
}

function absUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value.replace(/^\/+/, "")}`;
}

function cleanText(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url, options = {}) {
  const res = await OmniBox.request(url, {
    method: options.method || "GET",
    headers: {
      ...HEADERS,
      ...(options.headers || {}),
      Referer: options.referer || `${BASE_URL}/`,
    },
    timeout: options.timeout || 20000,
    body: options.body,
  });

  if (!res || Number(res.statusCode) < 200 || Number(res.statusCode) >= 400) {
    throw new Error(`HTTP ${res?.statusCode || "unknown"} @ ${url}`);
  }
  return getBodyText(res);
}

function extractVideos(html) {
  const videos = [];
  const re = /<a[^>]*href="(\/index\.php\/vod\/detail\/id\/(\d+)\.html)"[^>]*title="([^"]*)"[^>]*>[\s\S]*?<\/a>/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(html)) !== null) {
    const vodId = String(m[2] || "").trim();
    const vodName = String(m[3] || "").trim();
    if (!vodId || !vodName || seen.has(vodId)) continue;
    seen.add(vodId);

    const block = m[0];
    const picMatch = block.match(/data-src="([^"]*)"/) || block.match(/src="([^"]*)"/);
    const vodPic = picMatch ? absUrl(picMatch[1]) : "";

    let vodRemarks = "";
    const rm = block.match(/public-list-prb[^>]*>([^<]*)<\/span>/);
    if (rm) vodRemarks = cleanText(rm[1]);
    if (!vodRemarks) {
      const rm2 = block.match(/public-list-subtitle[^>]*>([^<]*)<\/div>/);
      if (rm2) vodRemarks = cleanText(rm2[1]);
    }

    videos.push({
      vod_id: vodId,
      vod_name: vodName,
      vod_pic: vodPic,
      vod_remarks: vodRemarks,
      type_id: "",
      type_name: "",
    });
  }
  return videos;
}

function extractSectionVideos(html, tid) {
  const sectionMap = {
    "1": "最新电影",
    "2": "最新连续剧",
    "3": "最新综艺",
    "4": "最新动漫",
    "37": "最新Netflix",
    "40": "最新纪录片",
  };
  const sectionName = sectionMap[String(tid || "")];
  if (!sectionName) return extractVideos(html);

  const allSections = ["最新热播", "最新Netflix", "最新电影", "最新连续剧", "最新资讯", "最新动漫", "最新综艺", "最新纪录片"];
  const tag = `title-h cor4">${sectionName}`;
  const start = html.indexOf(tag);
  if (start < 0) return [];

  let end = html.length;
  for (const name of allSections) {
    if (name === sectionName) continue;
    const nextTag = `title-h cor4">${name}`;
    const pos = html.indexOf(nextTag, start + tag.length);
    if (pos > 0 && pos < end) end = pos;
  }

  const sectionHtml = html.substring(start, end);
  const videos = extractVideos(sectionHtml);
  const seen = new Set();
  return videos.filter((v) => {
    if (seen.has(v.vod_id)) return false;
    seen.add(v.vod_id);
    return true;
  });
}

function splitPlayGroups(html) {
  const $ = cheerio.load(html);
  const sourceNames = $(".anthology-tab .swiper-slide")
    .map((_, el) => {
      const raw = cleanText($(el).text());
      return raw.replace(/\d+\s*集?$/g, "").trim();
    })
    .get()
    .filter(Boolean);

  const playSources = [];
  $(".anthology-list .anthology-list-box").each((boxIdx, box) => {
    const episodes = [];
    const seen = new Set();
    $(box)
      .find('a[href*="/index.php/vod/play/"]')
      .each((_, a) => {
        const epUrl = String($(a).attr("href") || "").replace(/&amp;/g, "&").trim();
        const epTitle = cleanText($(a).text());
        if (!epTitle || !epUrl || seen.has(epUrl)) return;
        seen.add(epUrl);
        episodes.push({
          name: epTitle,
          playId: absUrl(epUrl),
        });
      });

    if (episodes.length) {
      playSources.push({
        name: sourceNames[boxIdx] || `线路${boxIdx + 1}`,
        episodes,
      });
    }
  });

  if (!playSources.length) {
    const episodes = [];
    const seen = new Set();
    $('a[href*="/index.php/vod/play/"]').each((_, a) => {
      const epUrl = String($(a).attr("href") || "").replace(/&amp;/g, "&").trim();
      const epTitle = cleanText($(a).text());
      if (!epTitle || !epUrl || seen.has(epUrl)) return;
      seen.add(epUrl);
      episodes.push({
        name: epTitle,
        playId: absUrl(epUrl),
      });
    });
    if (episodes.length) playSources.push({ name: sourceNames[0] || "高清", episodes });
  }

  return playSources;
}

async function home(params, context) {
  try {
    const html = await fetchText(`${BASE_URL}/`);
    const list = extractVideos(html);
    await OmniBox.log("info", `[耐视点播][home] list=${list.length}`);
    return { class: CLASS_LIST, list };
  } catch (e) {
    await OmniBox.log("error", `[耐视点播][home] ${e.message}`);
    return { class: CLASS_LIST, list: [] };
  }
}

async function category(params, context) {
  try {
    const tid = String(params.categoryId || params.type_id || "1");
    const page = Math.max(1, parseInt(params.page || 1, 10));
    const url = `${BASE_URL}/index.php/vod/show/id/${tid}.html?page=${page}`;
    const html = await fetchText(url);
    let list = extractVideos(html);

    if (!list.length) {
      const homeHtml = await fetchText(`${BASE_URL}/`);
      if (homeHtml) list = extractSectionVideos(homeHtml, tid);
    }

    const pageMatches = [...html.matchAll(/page=(\d+)/g)].map((x) => parseInt(x[1], 10)).filter(Boolean);
    let pagecount = pageMatches.length ? Math.max(...pageMatches) : 1;
    if (list.length && !pagecount) pagecount = 1;

    await OmniBox.log("info", `[耐视点播][category] tid=${tid} page=${page} list=${list.length}`);
    return {
      page,
      pagecount,
      total: list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[耐视点播][category] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const id = String(params.videoId || params.id || "").trim();
    if (!id) return { list: [] };

    const url = /^https?:\/\//i.test(id) ? id : `${BASE_URL}/index.php/vod/detail/id/${id}.html`;
    const html = await fetchText(url);
    if (!html) return { list: [] };

    let vodName = (html.match(/<title>《([^》]+)》/) || [])[1] || "";
    if (!vodName) {
      const tm = html.match(/slide-info-title[^>]*>([^<]+)</);
      if (tm) vodName = cleanText(tm[1]);
    }

    let vodPic = "";
    const pm = html.match(/detail-pic[\s\S]*?data-src="([^"]*)"/);
    if (pm) vodPic = absUrl(pm[1]);

    let vodContent = "";
    const cm = html.match(/id="height_limit"[^>]*>([\s\S]*?)<\/div>/);
    if (cm) vodContent = cleanText(cm[1]);

    let vodYear = "";
    let ym = html.match(/年份<\/em>[\s\S]*?<span>(\d{4})<\/span>/);
    if (!ym) ym = html.match(/年份[\s\S]*?(\d{4})/);
    if (ym) vodYear = ym[1];

    let vodArea = "";
    let am = html.match(/地区<\/em>[\s\S]*?<span>([^<]+)<\/span>/);
    if (!am) am = html.match(/地区<\/em>\s*([^<\n]+)/);
    if (am) vodArea = cleanText(am[1]);

    let vodDirector = "";
    const dm = html.match(/导演<\/em>\s*([^<\n]+)/);
    if (dm) vodDirector = cleanText(dm[1]) === "未知" ? "" : cleanText(dm[1]);

    let vodActor = "";
    const arm = html.match(/主演<\/em>\s*([^<\n]+)/);
    if (arm) vodActor = cleanText(arm[1]) === "未知" ? "" : cleanText(arm[1]);

    const vodPlaySources = splitPlayGroups(html);
    if (!vodPlaySources.length) return { list: [] };

    await OmniBox.log("info", `[耐视点播][detail] id=${id} sources=${vodPlaySources.length}`);
    return {
      list: [{
        vod_id: id,
        vod_name: vodName,
        vod_pic: vodPic,
        vod_content: vodContent || "暂无简介",
        vod_year: vodYear,
        vod_area: vodArea,
        vod_director: vodDirector,
        vod_actor: vodActor,
        vod_play_sources: vodPlaySources,
      }],
    };
  } catch (e) {
    await OmniBox.log("error", `[耐视点播][detail] ${e.message}`);
    return { list: [] };
  }
}

async function play(params, context) {
  try {
    const flag = String(params.flag || "");
    const id = String(params.playId || params.id || "").trim();
    let playUrl = id;
    if (!/^https?:\/\//i.test(playUrl)) playUrl = absUrl(playUrl);

    const playHeaders = { "User-Agent": UA, Referer: `${BASE_URL}/` };
    const html = await fetchText(playUrl, { headers: playHeaders, referer: `${BASE_URL}/` });

    const m = html.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
    if (m) {
      try {
        const playerData = JSON.parse(m[1]);
        if (playerData.url) {
          await OmniBox.log("info", `[耐视点播][play] player_aaaa hit flag=${flag}`);
          return {
            parse: 0,
            urls: [{ name: "播放", url: playerData.url }],
            header: { "User-Agent": UA, Referer: playUrl },
          };
        }
      } catch (_) {}
    }

    const m3u8Match = html.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);
    if (m3u8Match) {
      await OmniBox.log("info", `[耐视点播][play] m3u8 hit flag=${flag}`);
      return {
        parse: 0,
        urls: [{ name: "播放", url: m3u8Match[1] }],
        header: { "User-Agent": UA, Referer: playUrl },
      };
    }

    await OmniBox.log("info", `[耐视点播][play] fallback sniff flag=${flag}`);
    return {
      parse: 1,
      url: playUrl,
      urls: [{ name: "播放页", url: playUrl }],
      header: playHeaders,
    };
  } catch (e) {
    await OmniBox.log("error", `[耐视点播][play] ${e.message}`);
    return { parse: 0, urls: [], header: {} };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params.keyword || params.wd || params.key || "").trim();
    const page = Math.max(1, parseInt(params.page || 1, 10));
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };

    const url = `${BASE_URL}/index.php/vod/search.html?wd=${encodeURIComponent(keyword)}`;
    const html = await fetchText(url);
    const list = extractVideos(html);
    await OmniBox.log("info", `[耐视点播][search] keyword=${keyword} list=${list.length}`);
    return {
      page,
      pagecount: list.length > 0 ? 1 : 0,
      total: list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[耐视点播][search] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}
