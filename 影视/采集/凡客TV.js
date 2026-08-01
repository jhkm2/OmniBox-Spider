// @name 凡客TV
// @author 梦
// @description 刮削：已接入，弹幕：未接入，嗅探：按官方 POST 播放接口直链优先（失败时页面回退）；已补首页推荐与关键词搜索
// @dependencies cheerio
// @version 1.3.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/凡客TV.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");
const querystring = require("querystring");
const { execFile } = require("child_process");
const { promisify } = require("util");

const BASE_URL = "https://fktv.me";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0";
const FKTV_COOKIE = "_did=57nTmEknMZ146xw4KXGHDCHk1MjshRyY";
const execFileAsync = promisify(execFile);

function _json(data) {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

async function _log(level, message, extra) {
  const suffix = typeof extra === "undefined" ? "" : ` | ${_json(extra)}`;
  await OmniBox.log(level, `[FKTV] ${message}${suffix}`);
}

function _getBodyText(res) {
  const body = (res && res.body) ? res.body : res;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.toString();
  return String(body || "");
}

function _safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function _normalizePagination(page, pageSize, total) {
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20;
  const safeTotal = Number.isFinite(total) && total >= 0 ? total : 0;
  const pagecount = safeTotal > 0 ? Math.ceil(safeTotal / safePageSize) : (safePage > 1 ? safePage : 1);
  return { page: safePage, pagecount, limit: safePageSize, total: safeTotal };
}

function _buildAjaxHeaders(referer) {
  const headers = {
    "User-Agent": UA,
    "Referer": referer || BASE_URL,
    "Origin": BASE_URL,
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "DNT": "1",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Sec-GPC": "1",
    "sec-ch-ua": '"Chromium";v="146", "Not-A.Brand";v="24", "Microsoft Edge";v="146"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"'
  };
  if (FKTV_COOKIE) headers.Cookie = FKTV_COOKIE;
  return headers;
}

function _buildPageHeaders(referer) {
  const headers = {
    "User-Agent": UA,
    "Referer": referer || BASE_URL
  };
  if (FKTV_COOKIE) headers.Cookie = FKTV_COOKIE;
  return headers;
}

function _extractPageState(html) {
  const state = {
    movieId: "",
    linkId: "",
    links: [],
    playLinks: [],
    playErrorType: ""
  };

  const movieIdMatch = html.match(/let\s+movieId\s*=\s*['"]([^'"]+)['"]/);
  if (movieIdMatch) state.movieId = movieIdMatch[1];

  const linkIdMatch = html.match(/let\s+linkId\s*=\s*['"]([^'"]+)['"]/);
  if (linkIdMatch) state.linkId = linkIdMatch[1];

  const linksMatch = html.match(/var\s+links\s*=\s*(\[[\s\S]*?\]);/);
  if (linksMatch && linksMatch[1]) state.links = _safeJsonParse(linksMatch[1], []) || [];

  const playLinksMatch = html.match(/var\s+play_links\s*=\s*(\[[\s\S]*?\]);/);
  if (playLinksMatch && playLinksMatch[1]) state.playLinks = _safeJsonParse(playLinksMatch[1], []) || [];

  const playErrorTypeMatch = html.match(/var\s+play_error_type\s*=\s*['"]([^'"]+)['"]/);
  if (playErrorTypeMatch) state.playErrorType = playErrorTypeMatch[1];

  return state;
}

function _extractVodId(href) {
  const match = String(href || "").match(/\/movie\/detail\/([0-9a-fA-F]+)/);
  return match ? match[1] : "";
}

function _absUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value}`;
}

function _collectTags($, $scope) {
  const tags = [];
  $scope.find(".tag").each((_, el) => {
    const txt = $(el).text().trim();
    if (txt) tags.push(txt);
  });
  return tags;
}

function _buildVodCard($, $scope, typeId = "") {
  const titleAnchor = $scope.find("a[title*='']").filter((_, el) => _extractVodId($(el).attr("href"))).first();
  const fallbackAnchor = $scope.find(".normal-title, .hover-title").first();
  const anchor = titleAnchor.length ? titleAnchor : fallbackAnchor;
  const href = anchor.attr("href") || "";
  const vodId = _extractVodId(href);
  if (!vodId) return null;

  const vodName = anchor.attr("title") || anchor.text().trim() || $scope.find(".normal-title, .hover-title").first().text().trim();
  if (!vodName) return null;

  const vodPic = _absUrl(
    $scope.find(".lazy-load").first().attr("data-src")
    || $scope.find(".lazy-load").first().attr("src")
    || $scope.find("img").first().attr("src")
    || ""
  );

  const tags = _collectTags($, $scope);
  const categoryText = $scope.find(".category").first().text().replace(/\s+/g, " ").trim();
  const remarks = [...tags, categoryText].filter(Boolean).join(" | ");

  return {
    vod_id: vodId,
    vod_name: vodName,
    vod_pic: vodPic,
    vod_url: `${BASE_URL}/movie/detail/${vodId}`,
    type_id: String(typeId || ""),
    type_name: tags[0] || "",
    vod_remarks: remarks
  };
}

function _dedupVodList(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter((it) => {
    if (!it || !it.vod_id || seen.has(it.vod_id)) return false;
    seen.add(it.vod_id);
    return true;
  });
}

function _extractLineTabs(html) {
  const lines = [];
  const re = /<div\s+data-line=["']([^"']+)["'][^>]*class=["'][^"']*item-wrap[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = String(m[1] || "").trim();
    const name = String(m[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (id) lines.push({ id, name: name || id });
  }
  return lines;
}


function _pickEpisodeName(item) {
  return String((item && (item.name || item.title || item.id)) || "").trim() || "正片";
}

function _normalizePlayLinks(playLinks) {
  return (Array.isArray(playLinks) ? playLinks : []).map((item) => {
    const sourceUrl = item && (item.m3u8_url || item.preview_m3u8_url || "");
    if (!sourceUrl) return null;
    const full = /^https?:\/\//i.test(sourceUrl)
      ? sourceUrl
      : `${BASE_URL}${sourceUrl.startsWith("/") ? "" : "/"}${sourceUrl}`;
    return {
      lineId: item.id || "",
      name: item.name || item.id || "线路",
      url: full,
      raw: item
    };
  }).filter(Boolean);
}

function _buildDirectResult(urls, referer, flag = "fktv") {
  const mappedUrls = urls.map((it) => ({ name: it.name, url: it.url }));
  const headers = {
    "User-Agent": UA,
    "Referer": referer || BASE_URL,
    "Origin": BASE_URL
  };
  return {
    parse: 0,
    url: mappedUrls.length === 1 ? mappedUrls[0].url : undefined,
    urls: mappedUrls,
    header: headers,
    headers
  };
}

function _buildFallback(pageUrl, name = "FKTV 接口未返回可播地址") {
  const headers = {
    "User-Agent": UA,
    "Referer": pageUrl,
    "Origin": BASE_URL
  };
  return {
    parse: 1,
    url: pageUrl,
    urls: [{ name, url: pageUrl }],
    header: headers,
    headers
  };
}

function _encodePlayId(meta) {
  const ordered = {
    line_id: meta.line_id || "",
    link_id: meta.link_id || "",
    movie_id: meta.movie_id || "",
    line_name: meta.line_name || "",
    episode_name: meta.episode_name || "",
    type: meta.type || "switch",
    page: meta.page || ""
  };
  return JSON.stringify(ordered);
}

async function _fetchPlayLinks(pageUrl, movieId, linkId) {
  const body = querystring.stringify({ link_id: linkId, is_switch: 1 });
  const url = `${BASE_URL}/movie/detail/${movieId}`;

  await _log("info", "请求播放切换接口", {
    url,
    referer: pageUrl,
    body: { link_id: linkId, is_switch: 1 },
    hasCookie: !!FKTV_COOKIE,
    cookiePreview: FKTV_COOKIE ? `${FKTV_COOKIE.slice(0, 24)}...` : ""
  });

  let text = "";
  let usedTransport = "OmniBox.request";

  try {
    const res = await OmniBox.request(url, {
      method: "POST",
      headers: _buildAjaxHeaders(pageUrl),
      body,
      timeout: 20000
    });
    text = _getBodyText(res);
  } catch (e) {
    await _log("warn", "OmniBox.request 调用播放接口失败，准备回退 curl", { message: e.message });
  }

  let json = _safeJsonParse(text, null);
  let data = json && json.data ? json.data : {};
  let normalized = _normalizePlayLinks(data.play_links || []);

  const requestLooksBad = !json || !json.status || (!normalized.length && !data.play_error_type);
  if (requestLooksBad) {
    usedTransport = "curl";
    const args = [
      '-sS',
      url,
      '-H', 'accept: application/json, text/javascript, */*; q=0.01',
      '-H', 'accept-language: zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
      '-H', 'content-type: application/x-www-form-urlencoded; charset=UTF-8',
      '-H', `origin: ${BASE_URL}`,
      '-H', `referer: ${pageUrl}`,
      '-H', 'x-requested-with: XMLHttpRequest',
      '-H', `user-agent: ${UA}`,
      '--data-raw', body
    ];
    if (FKTV_COOKIE) args.splice(6, 0, '-b', FKTV_COOKIE);

    await _log("warn", "OmniBox.request 返回异常，回退本机 curl", { url, body: { link_id: linkId, is_switch: 1 } });
    const { stdout, stderr } = await execFileAsync('curl', args, { timeout: 20000, maxBuffer: 1024 * 1024 });
    if (stderr && String(stderr).trim()) {
      await _log("warn", "curl stderr", String(stderr).trim());
    }
    text = String(stdout || "");
    json = _safeJsonParse(text, null) || {};
    data = json.data || {};
    normalized = _normalizePlayLinks(data.play_links || []);
  }

  await _log("info", "播放切换接口响应", {
    transport: usedTransport,
    status: json?.status || "",
    play_error_type: data.play_error_type || "",
    play_error: data.play_error || "",
    play_links_count: Array.isArray(data.play_links) ? data.play_links.length : 0,
    normalized_count: normalized.length,
    normalized_urls: normalized.map((it) => ({ lineId: it.lineId, name: it.name, url: it.url }))
  });

  return {
    playErrorType: data.play_error_type || "",
    playError: data.play_error || "",
    urls: normalized,
    raw: json || {},
    transport: usedTransport
  };
}

async function home() {
  const res = await OmniBox.request(BASE_URL, {
    method: "GET",
    headers: _buildPageHeaders(BASE_URL),
    timeout: 20000
  });
  const html = _getBodyText(res);
  const $ = cheerio.load(html);

  const classes = [
    { type_id: "1", type_name: "电影" },
    { type_id: "2", type_name: "剧集" },
    { type_id: "4", type_name: "动漫" },
    { type_id: "3", type_name: "综艺" },
    { type_id: "8", type_name: "短剧" },
    { type_id: "6", type_name: "纪录片" },
    { type_id: "7", type_name: "解说" },
    { type_id: "5", type_name: "音乐" }
  ];

  const list = [];
  $(".video-wrap .item-wrap.vertical.group, .list-wrap .item-wrap.vertical.group").each((_, el) => {
    const item = _buildVodCard($, $(el));
    if (item) list.push(item);
  });

  const dedup = _dedupVodList(list);
  await _log("info", "home 解析结果", { count: dedup.length, first: dedup[0] || null });

  return {
    class: classes,
    list: dedup.slice(0, 24)
  };
}

async function category(params) {
  const page = params.page ? Number(params.page) : 1;
  const pageSize = params.page_size ? Number(params.page_size) : 32;
  const typeId = params.type_id || params.cat_id || params.typeId || params.type || params.categoryId || "";
  const url = `${BASE_URL}/channel?page=${page}&cat_id=${typeId}&page_size=${pageSize}&order=new`;

  await _log("info", "category 入参", params);
  await _log("info", "category 请求地址", { url });

  const res = await OmniBox.request(url, { method: "GET", headers: _buildPageHeaders(BASE_URL) });
  const html = _getBodyText(res);
  const $ = cheerio.load(html);
  const list = [];

  $(".video-wrap .item-wrap.vertical.group, .list-wrap .item-wrap.vertical.group, .meta-wrap, .hover-wrap").each((_, el) => {
    const $el = $(el);
    const card = _buildVodCard($, $el.hasClass("meta-wrap") ? $el.parent() : $el);
    if (card) {
      card.type_id = String(typeId || "");
      list.push(card);
    }
  });

  const dedup = _dedupVodList(list);

  await _log("info", "category 解析结果", { count: dedup.length, first: dedup[0] || null });
  return { ..._normalizePagination(page, pageSize, dedup.length), list: dedup };
}

async function detail(params) {
  const id = String(params.videoId || params.vod_id || params.id || "").trim();
  await _log("info", "detail 入参", params);
  if (!id) return { list: [] };

  const pageUrl = id.startsWith("http") ? id : `${BASE_URL}/movie/detail/${id}`;
  await _log("info", "detail 请求地址", { pageUrl });

  const res = await OmniBox.request(pageUrl, {
    method: "GET",
    headers: _buildPageHeaders(BASE_URL),
    timeout: 20000
  });
  const html = _getBodyText(res);
  const $ = cheerio.load(html);
  const state = _extractPageState(html);
  const lineTabs = _extractLineTabs(html);

  await _log("info", "detail 页面状态解析", {
    movieId: state.movieId,
    currentLinkId: state.linkId,
    linksCount: state.links.length,
    pagePlayLinksCount: state.playLinks.length,
    playErrorType: state.playErrorType,
    lineTabs
  });

  const rawTitle = $("h1, h2, .title").first().text().trim() || $("title").text().trim() || pageUrl;
  const title = rawTitle.replace(/-免费在线观看-凡客影视$/, "").trim() || rawTitle;
  const poster = $(".meta-wrap .thumb").attr("data-src")
    || $("video").attr("poster")
    || $("meta[property='og:image']").attr("content")
    || "";
  const content = $("meta[name='description']").attr("content") || $(".hl-full-box").text().trim() || "";

  const realLines = lineTabs.length
    ? lineTabs
    : (state.playLinks || []).map((it) => ({ id: it.id || "", name: it.name || it.id || "线路" }));

  const vodPlaySources = [];
  for (const line of realLines) {
    const episodes = [];
    for (const ep of state.links || []) {
      if (!ep || !ep.id) continue;
      const playMeta = {
        type: "switch",
        movie_id: state.movieId || id,
        link_id: ep.id,
        line_id: line.id || "",
        line_name: line.name || line.id || "线路",
        episode_name: _pickEpisodeName(ep),
        page: pageUrl
      };
      episodes.push({
        name: _pickEpisodeName(ep),
        playId: _encodePlayId(playMeta)
      });
    }
    if (episodes.length) {
      vodPlaySources.push({
        name: line.name || line.id || "线路",
        episodes
      });
    }
  }

  await _log("info", "detail 最终线路结构", {
    sourceCount: vodPlaySources.length,
    sources: vodPlaySources.map((it) => ({
      name: it.name,
      episodeCount: Array.isArray(it.episodes) ? it.episodes.length : 0,
      firstEpisode: Array.isArray(it.episodes) && it.episodes[0] ? it.episodes[0] : null,
      secondEpisode: Array.isArray(it.episodes) && it.episodes[1] ? it.episodes[1] : null
    }))
  });

  const remarks = [];
  if (state.playErrorType === "captcha") remarks.push("站点当前需要验证码解锁");
  if (state.playErrorType === "need_vip") remarks.push("站点当前标记为 VIP 限制");

  return {
    list: [{
      vod_id: state.movieId || id,
      vod_name: title,
      vod_pic: poster,
      vod_url: pageUrl,
      vod_content: content,
      vod_remarks: remarks.join(" | "),
      vod_play_sources: vodPlaySources
    }]
  };
}

async function play(params) {
  try {
    await _log("info", "play 入参", params);

    const raw = String(params.playId || params.play_id || params.url || "").trim();
    if (!raw) throw new Error("播放标识为空");

    if (/\.(m3u8|mp4|flv)(\?|$)/i.test(raw)) {
      const direct = _buildDirectResult([{ name: "直链播放", url: raw }], BASE_URL);
      await _log("info", "play 直链入参直接返回", direct);
      return direct;
    }

    let meta = null;
    try { meta = JSON.parse(raw); } catch { meta = null; }
    await _log("info", "play 解析后的 playId", meta || raw);

    if (!meta && /^[0-9a-f]{32}$/i.test(raw)) {
      meta = { type: "switch", movie_id: "", link_id: raw, line_id: "", page: "" };
      await _log("warn", "play 检测到宿主仅回传 link_id，已做兜底包装", meta);
    }
    if (meta && !meta.page && meta.movie_id) {
      meta.page = `${BASE_URL}/movie/detail/${meta.movie_id}`;
    }

    const pageUrl = meta?.page || raw;
    if (!/^https?:\/\//i.test(pageUrl)) {
      const fallback = _buildFallback(`${BASE_URL}/movie/detail/${pageUrl}`);
      await _log("warn", "play 非法页面地址，回退", fallback);
      return fallback;
    }

    await _log("info", "play 详情页回读地址", { pageUrl });
    const pageRes = await OmniBox.request(pageUrl, {
      method: "GET",
      headers: _buildPageHeaders(BASE_URL),
      timeout: 20000
    });
    const html = _getBodyText(pageRes);
    const state = _extractPageState(html);

    const movieId = meta?.movie_id || state.movieId || "";
    const linkId = meta?.link_id || state.linkId || (state.links[0] && state.links[0].id) || "";
    const lineId = meta?.line_id || "";

    await _log("info", "play 页面状态", {
      movieId,
      linkId,
      lineId,
      playErrorType: state.playErrorType,
      pageDefaultLinkId: state.linkId,
      linksPreview: (state.links || []).slice(0, 5).map((it) => ({ id: it.id, name: it.name })),
      pagePlayLinks: state.playLinks
    });

    await _log("info", "play 即将按当前剧集请求接口", {
      movieId,
      requestedLinkId: linkId,
      requestedLineId: lineId || "",
      requestedEpisodeName: meta?.episode_name || ""
    });

    if (movieId && linkId) {
      const ajax = await _fetchPlayLinks(pageUrl, movieId, linkId);
      const pickedAjax = lineId ? ajax.urls.filter((it) => it.lineId === lineId) : ajax.urls;

      await _log("info", "play 接口结果过滤后", {
        transport: ajax.transport || "unknown",
        requestedLineId: lineId || "",
        requestedLinkId: linkId,
        requestedEpisodeName: meta?.episode_name || "",
        ajaxUrls: ajax.urls.map((it) => ({ lineId: it.lineId, name: it.name, url: it.url })),
        pickedAjax: pickedAjax.map((it) => ({ lineId: it.lineId, name: it.name, url: it.url })),
        playErrorType: ajax.playErrorType,
        playError: ajax.playError
      });

      if (pickedAjax.length) {
        const result = _buildDirectResult(pickedAjax, pageUrl);
        await _log("info", "play 使用接口过滤结果返回", {
          requestedLinkId: linkId,
          requestedLineId: lineId || "",
          requestedEpisodeName: meta?.episode_name || "",
          result
        });
        return result;
      }

      if (!lineId && ajax.urls.length) {
        const result = _buildDirectResult(ajax.urls, pageUrl);
        await _log("info", "play 未指定线路，返回该集全部官方线路地址", {
          requestedLinkId: linkId,
          requestedEpisodeName: meta?.episode_name || "",
          result
        });
        return result;
      }

      if (ajax.playErrorType === "need_vip") {
        const fallback = _buildFallback(pageUrl, "站点 VIP 播放页");
        await _log("warn", "play 被 VIP 限制拦截，回退页面", fallback);
        return fallback;
      }

      if (ajax.playErrorType === "captcha") {
        await _log("warn", "play 接口被 captcha 拦截", {
          movieId,
          linkId,
          lineId,
          hasCookie: !!FKTV_COOKIE
        });
      }
    }

    const inlineUrls = _normalizePlayLinks(state.playLinks);
    await _log("info", "play 页面内嵌 play_links 仅作诊断，不再作为剧集播放回退", {
      requestedLineId: lineId || "",
      requestedLinkId: linkId,
      inlineUrls: inlineUrls.map((it) => ({ lineId: it.lineId, name: it.name, url: it.url })),
      reason: "详情页内嵌 play_links 可能对应页面当前默认剧集，不能代表用户刚点击的目标剧集"
    });

    try {
      await _log("info", "play 开始 sniffVideo", { sniffUrl: pageUrl, headers: { "User-Agent": UA, "Referer": pageUrl } });
      const sniff = await OmniBox.sniffVideo(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
      await _log("info", "play sniffVideo 返回", sniff || null);
      if (sniff?.url) {
        const result = {
          parse: 0,
          url: sniff.url,
          urls: [{ name: meta?.line_name || "嗅探播放", url: sniff.url }],
          header: sniff.header || { "User-Agent": UA, "Referer": pageUrl, "Origin": BASE_URL },
          headers: sniff.header || { "User-Agent": UA, "Referer": pageUrl, "Origin": BASE_URL }};
        await _log("info", "play 使用 sniff 结果返回", result);
        return result;
      }
    } catch (e) {
      await _log("warn", "play sniffVideo 失败", { message: e.message, sniffUrl: pageUrl });
    }

    const fallback = _buildFallback(pageUrl, "FKTV 接口未返回当前剧集可播地址");
    await _log("warn", "play 所有路径失败，最终回退页面", {
      requestedLinkId: linkId,
      requestedLineId: lineId || "",
      requestedEpisodeName: meta?.episode_name || "",
      fallback
    });
    return fallback;
  } catch (e) {
    await _log("error", "play 异常", { message: e.message, stack: e.stack });
    return { parse: 0, urls: [], url: "", header: {}, headers: {} };
  }
}

async function search(params) {
  const keyword = params.keyword || params.key || params.wd || "";
  const page = params.page ? Number(params.page) : 1;
  const pageSize = params.page_size ? Number(params.page_size) : 20;
  await _log("info", "search 入参", params);
  if (!keyword) return { ..._normalizePagination(page, pageSize, 0), list: [] };

  const url = `${BASE_URL}/channel?keywords=${encodeURIComponent(keyword)}&page=${page}&page_size=${pageSize}`;
  await _log("info", "search 请求地址", { url, note: "凡客站内搜索实际跳转到 /channel?keywords=，原 /search 接口当前返回 500" });

  const res = await OmniBox.request(url, { method: "GET", headers: _buildPageHeaders(BASE_URL) });
  const html = _getBodyText(res);
  const $ = cheerio.load(html);
  const list = [];

  $(".video-wrap .item-wrap.vertical.group, .list-wrap .item-wrap.vertical.group, .meta-wrap, .hover-wrap").each((_, el) => {
    const $el = $(el);
    const card = _buildVodCard($, $el.hasClass("meta-wrap") ? $el.parent() : $el);
    if (card) list.push(card);
  });

  const dedup = _dedupVodList(list);

  await _log("info", "search 解析结果", { count: dedup.length, first: dedup[0] || null });
  return { ..._normalizePagination(page, pageSize, dedup.length), list: dedup };
}

runner.run({ home, category, detail, search, play });
