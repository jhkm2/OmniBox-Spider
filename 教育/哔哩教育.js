// @name 哔哩教育
// @author 
// @description 刮削：不支持，弹幕：支持，嗅探：不支持，登录：支持
// @dependencies: axios, crypto
// @version 1.1.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/教育/哔哩教育.js

const axios = require("axios");
const crypto = require("crypto");
const OmniBox = require("omnibox_sdk");

// ==================== 配置区域 ====================
const BILI_COOKIE = process.env.BILI_COOKIE || "";

const BILI_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.bilibili.com",
  ...(BILI_COOKIE ? { Cookie: BILI_COOKIE } : {}),
};

const isLoggedIn = () => Boolean(BILI_COOKIE && BILI_COOKIE.includes("SESSDATA="));

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 17, 6, 28,
];

function getMixinKey(raw) {
  return MIXIN_KEY_ENC_TAB.map((n) => raw[n]).join("").substring(0, 32);
}

let _wbiKeysCache = null;
let _searchHeadersCache = null;

function generateBuvid3() {
  const now = Date.now();
  const rand = Math.random().toString(16).substring(2, 10);
  const ts = now.toString(16);
  return `${ts}${rand}`;
}

function generateBuvid4() {
  const now = Date.now();
  const rand = Math.random().toString(16).substring(2, 14);
  const ts = now.toString(16);
  return `X${ts}${rand}`;
}

async function initSearchHeaders() {
  if (_searchHeadersCache) return _searchHeadersCache;
  let cookie = BILI_COOKIE || "";
  if (!cookie.includes("buvid3")) {
    cookie += `${cookie ? "; " : ""}buvid3=${generateBuvid3()}`;
  }
  if (!cookie.includes("buvid4")) {
    cookie += `; buvid4=${generateBuvid4()}`;
  }
  _searchHeadersCache = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: "https://search.bilibili.com/all?keyword=1",
    Origin: "https://search.bilibili.com",
    Cookie: cookie,
  };
  return _searchHeadersCache;
}

async function getWbiKeys() {
  if (_wbiKeysCache) return _wbiKeysCache;
  try {
    const navHeaders = await initSearchHeaders();
    const { data } = await axios.get("https://api.bilibili.com/x/web-interface/nav", {
      headers: navHeaders,
    });
    const { wbi_img: { img_url, sub_url } = {} } = data?.data || {};
    const imgKey = (img_url || "").split("/").pop().split(".")[0] || "";
    const subKey = (sub_url || "").split("/").pop().split(".")[0] || "";
    logInfo(`获取WbiKeys imgKey: ${imgKey}, subKey: ${subKey}`);
    _wbiKeysCache = { imgKey, subKey };
    return _wbiKeysCache;
  } catch (err) {
    logError("获取WbiKeys失败", err);
    return { imgKey: "", subKey: "" };
  }
}

async function signWbiParams(params) {
  const { imgKey, subKey } = await getWbiKeys();
  const mixinKey = getMixinKey(imgKey + subKey);
  const wts = Math.floor(Date.now() / 1000);
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((obj, key) => {
      if (params[key] !== undefined && params[key] !== null) {
        obj[key] = params[key];
      }
      return obj;
    }, {});
  sortedParams.wts = wts;
  const query = Object.entries(sortedParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const w_rid = crypto.createHash("md5").update(query + mixinKey).digest("hex");
  return { ...sortedParams, w_rid };
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(value) {
  return `<![CDATA[${String(value ?? "").replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
}

function dashBaseUrl(item) {
  return item?.base_url || item?.baseUrl || "";
}

function selectBestDashVideo(videos = []) {
  let targetVideos = videos.filter((v) => v.codecid === 7 || (v.codecs && v.codecs.startsWith("avc")));
  if (targetVideos.length === 0) targetVideos = videos;

  return [...targetVideos].sort((a, b) => {
    if ((b.id || 0) !== (a.id || 0)) return (b.id || 0) - (a.id || 0);
    if ((b.bandwidth || 0) !== (a.bandwidth || 0)) return (b.bandwidth || 0) - (a.bandwidth || 0);
    return (b.width || 0) - (a.width || 0);
  })[0];
}

function buildMpd(dash) {
  const duration = Number(dash?.duration || 0);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" minBufferTime="PT1.5S" mediaPresentationDuration="PT${xmlEscape(duration)}S">`,
    "  <Period>",
  ];

  const bestVideo = selectBestDashVideo(dash?.video || []);
  const videos = bestVideo ? [bestVideo] : [];
  if (videos.length) {
    lines.push('    <AdaptationSet mimeType="video/mp4" contentType="video" subsegmentAlignment="true" subsegmentStartsWithSAP="1">');
    for (const video of videos) {
      lines.push(
        `      <Representation id="${xmlEscape(video.id)}" codecs="${xmlEscape(video.codecs || "avc1.64001E")}" bandwidth="${xmlEscape(video.bandwidth || 0)}" width="${xmlEscape(video.width || 0)}" height="${xmlEscape(video.height || 0)}" frameRate="${xmlEscape(video.frame_rate || "")}">`,
      );
      lines.push(`        <BaseURL>${cdata(dashBaseUrl(video))}</BaseURL>`);
      if (video.SegmentBase?.Initialization) {
        lines.push(`        <SegmentBase indexRange="${xmlEscape(video.SegmentBase.indexRange || "")}">`);
        lines.push(`          <Initialization range="${xmlEscape(video.SegmentBase.Initialization)}"/>`);
        lines.push("        </SegmentBase>");
      }
      lines.push("      </Representation>");
    }
    lines.push("    </AdaptationSet>");
  }

  const audios = Array.isArray(dash?.audio) ? dash.audio : [];
  if (audios.length) {
    lines.push('    <AdaptationSet mimeType="audio/mp4" contentType="audio" subsegmentAlignment="true" subsegmentStartsWithSAP="1">');
    for (const audio of audios) {
      lines.push(
        `      <Representation id="${xmlEscape(audio.id)}" codecs="${xmlEscape(audio.codecs || "mp4a.40.2")}" bandwidth="${xmlEscape(audio.bandwidth || 0)}">`,
      );
      lines.push(`        <BaseURL>${cdata(dashBaseUrl(audio))}</BaseURL>`);
      if (audio.SegmentBase?.Initialization) {
        lines.push(`        <SegmentBase indexRange="${xmlEscape(audio.SegmentBase.indexRange || "")}">`);
        lines.push(`          <Initialization range="${xmlEscape(audio.SegmentBase.Initialization)}"/>`);
        lines.push("        </SegmentBase>");
      }
      lines.push("      </Representation>");
    }
    lines.push("    </AdaptationSet>");
  }

  lines.push("  </Period>");
  lines.push("</MPD>");
  return lines.join("\n");
}

function getRuntimeContext(params = {}, context = {}) {
  return context && Object.keys(context).length ? context : params?.context || {};
}

function buildDashProxyUrl(params = {}, context = {}, avid, cid) {
  const ids = `${avid}_${cid}`;
  const runtimeContext = getRuntimeContext(params, context);
  const baseURL = String(runtimeContext?.baseURL || params?.baseURL || "").replace(/\/+$/, "");
  const sourceId = String(runtimeContext?.sourceId || params?.sourceId || "");
  const template = process.env.BILI_DASH_PROXY_URL || "";

  if (template) {
    return template
      .replaceAll("{baseURL}", baseURL)
      .replaceAll("{sourceId}", encodeURIComponent(sourceId))
      .replaceAll("{ids}", encodeURIComponent(ids))
      .replaceAll("{avid}", encodeURIComponent(avid))
      .replaceAll("{cid}", encodeURIComponent(cid))
      .replaceAll("{qn}", "127")
      .replaceAll("{fnval}", "4048")
      .replaceAll("{fourk}", "1");
  }

  return "";
}

function buildDashDataUrl(dash) {
  const mpd = buildMpd(dash);
  return `data:application/dash+xml;base64,${Buffer.from(mpd, "utf8").toString("base64")}`;
}

// ==================== 教育分类 ====================
const CLASSES = [
  { type_id: "1年级语文", type_name: "1年级语文" },
  { type_id: "1年级数学", type_name: "1年级数学" },
  { type_id: "1年级英语", type_name: "1年级英语" },
  { type_id: "2年级语文", type_name: "2年级语文" },
  { type_id: "2年级数学", type_name: "2年级数学" },
  { type_id: "2年级英语", type_name: "2年级英语" },
  { type_id: "3年级语文", type_name: "3年级语文" },
  { type_id: "3年级数学", type_name: "3年级数学" },
  { type_id: "3年级英语", type_name: "3年级英语" },
  { type_id: "4年级语文", type_name: "4年级语文" },
  { type_id: "4年级数学", type_name: "4年级数学" },
  { type_id: "4年级英语", type_name: "4年级英语" },
  { type_id: "5年级语文", type_name: "5年级语文" },
  { type_id: "5年级数学", type_name: "5年级数学" },
  { type_id: "5年级英语", type_name: "5年级英语" },
  { type_id: "6年级语文", type_name: "6年级语文" },
  { type_id: "6年级数学", type_name: "6年级数学" },
  { type_id: "6年级英语", type_name: "6年级英语" },
  { type_id: "7年级语文", type_name: "7年级语文" },
  { type_id: "7年级数学", type_name: "7年级数学" },
  { type_id: "7年级英语", type_name: "7年级英语" },
  { type_id: "7年级历史", type_name: "7年级历史" },
  { type_id: "7年级地理", type_name: "7年级地理" },
  { type_id: "7年级生物", type_name: "7年级生物" },
  { type_id: "7年级物理", type_name: "7年级物理" },
  { type_id: "7年级化学", type_name: "7年级化学" },
  { type_id: "8年级语文", type_name: "8年级语文" },
  { type_id: "8年级数学", type_name: "8年级数学" },
  { type_id: "8年级英语", type_name: "8年级英语" },
  { type_id: "8年级历史", type_name: "8年级历史" },
  { type_id: "8年级地理", type_name: "8年级地理" },
  { type_id: "8年级生物", type_name: "8年级生物" },
  { type_id: "8年级物理", type_name: "8年级物理" },
  { type_id: "8年级化学", type_name: "8年级化学" },
  { type_id: "9年级语文", type_name: "9年级语文" },
  { type_id: "9年级数学", type_name: "9年级数学" },
  { type_id: "9年级英语", type_name: "9年级英语" },
  { type_id: "9年级历史", type_name: "9年级历史" },
  { type_id: "9年级地理", type_name: "9年级地理" },
  { type_id: "9年级生物", type_name: "9年级生物" },
  { type_id: "9年级物理", type_name: "9年级物理" },
  { type_id: "9年级化学", type_name: "9年级化学" },
  { type_id: "高一语文", type_name: "高一语文" },
  { type_id: "高一数学", type_name: "高一数学" },
  { type_id: "高一英语", type_name: "高一英语" },
  { type_id: "高一历史", type_name: "高一历史" },
  { type_id: "高一地理", type_name: "高一地理" },
  { type_id: "高一生物", type_name: "高一生物" },
  { type_id: "高一思想政治", type_name: "高一思想政治" },
  { type_id: "高一物理", type_name: "高一物理" },
  { type_id: "高一化学", type_name: "高一化学" },
  { type_id: "高二语文", type_name: "高二语文" },
  { type_id: "高二数学", type_name: "高二数学" },
  { type_id: "高二英语", type_name: "高二英语" },
  { type_id: "高二历史", type_name: "高二历史" },
  { type_id: "高二地理", type_name: "高二地理" },
  { type_id: "高二生物", type_name: "高二生物" },
  { type_id: "高二思想政治", type_name: "高二思想政治" },
  { type_id: "高二物理", type_name: "高二物理" },
  { type_id: "高二化学", type_name: "高二化学" },
  { type_id: "高三语文", type_name: "高三语文" },
  { type_id: "高三数学", type_name: "高三数学" },
  { type_id: "高三英语", type_name: "高三英语" },
  { type_id: "高三历史", type_name: "高三历史" },
  { type_id: "高三地理", type_name: "高三地理" },
  { type_id: "高三生物", type_name: "高三生物" },
  { type_id: "高三思想政治", type_name: "高三思想政治" },
  { type_id: "高三物理", type_name: "高三物理" },
  { type_id: "高三化学", type_name: "高三化学" },
  { type_id: "奥数", type_name: "奥数" },
  { type_id: "奥林匹克物理", type_name: "奥物" },
  { type_id: "奥林匹克化学", type_name: "奥化" },
  { type_id: "高中信息技术", type_name: "高中信息技术" },
];

const QUALITY_NAME_MAP = {
  127: "8K 超高清",
  126: "杜比视界",
  125: "HDR 真彩色",
  120: "4K 超清",
  116: "1080P60 高帧率",
  112: "1080P+ 高码率",
  80: "1080P 高清",
  74: "720P60 高帧率",
  64: "720P 高清",
  32: "480P 清晰",
  16: "360P 流畅",
};

function logInfo(msg) {
  OmniBox.log("info", `[BILI-EDU] ${msg}`);
}

function logError(msg, err) {
  OmniBox.log("error", `[BILI-EDU] ${msg}: ${err?.message || err}`);
}

function fixCover(url) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function formatDuration(seconds) {
  const sec = parseInt(seconds, 10) || 0;
  if (sec <= 0) return "00:00";
  const minutes = Math.floor(sec / 60);
  const secs = sec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatSearchDuration(duration) {
  if (!duration || typeof duration !== "string") return "00:00";
  const parts = duration.split(":");
  return parts.length === 2 ? duration : "00:00";
}

async function home(params) {
  try {
    const searchHeaders = await initSearchHeaders();
    const rawParams = { search_type: "video", keyword: "启蒙", page: 1 };
    const signedParams = await signWbiParams(rawParams);
    const { data } = await axios.get("https://api.bilibili.com/x/web-interface/search/type", {
      headers: searchHeaders,
      params: signedParams,
    });

    const list = (data?.data?.result || [])
      .filter((item) => item.type === "video")
      .map((item) => ({
        vod_id: String(item.aid || ""),
        vod_name: String(item.title || "").replace(/<[^>]*>/g, ""),
        vod_pic: fixCover(item.pic),
        vod_remarks: formatSearchDuration(item.duration),
      }));

    return {
      class: CLASSES,
      list,
    };
  } catch (error) {
    logError("首页获取失败", error);
    return { class: CLASSES, list: [] };
  }
}

async function category(params) {
  const keyword = params.categoryId || "";
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  if (!keyword) {
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }

  try {
    const rawParams = { search_type: "video", keyword, page };
    const signedParams = await signWbiParams(rawParams);
    const searchHeaders = await initSearchHeaders();
    const { data } = await axios.get("https://api.bilibili.com/x/web-interface/search/type", {
      headers: searchHeaders,
      params: signedParams,
    });

    const list = (data?.data?.result || [])
      .filter((item) => item.type === "video")
      .map((item) => ({
        vod_id: String(item.aid || ""),
        vod_name: String(item.title || "").replace(/<[^>]*>/g, ""),
        vod_pic: fixCover(item.pic),
        vod_remarks: formatSearchDuration(item.duration),
      }));

    return {
      page,
      pagecount: data?.data?.numPages || 1,
      total: data?.data?.numResults || list.length,
      list,
    };
  } catch (error) {
    logError("分类获取失败", error);
    return { page, pagecount: 0, total: 0, list: [] };
  }
}

async function search(params) {
  return category({
    categoryId: params.keyword || params.wd || "",
    page: params.page,
  });
}

async function detail(params) {
  const videoId = params.videoId;
  if (!videoId) return { list: [] };

  try {
    const { data } = await axios.get(`https://api.bilibili.com/x/web-interface/view?aid=${videoId}`, {
      headers: BILI_HEADERS,
    });

    const video = data?.data;
    if (!video) return { list: [] };

    const episodes = (video.pages || []).map((p, i) => {
      const part = p.part || `第${i + 1}集`;
      return {
        name: part,
        playId: `${videoId}_${p.cid}`,
      };
    });

    return {
      list: [
        {
          vod_id: String(videoId),
          vod_name: String(video.title || "").replace(/<[^>]*>/g, ""),
          vod_pic: fixCover(video.pic),
          vod_content: String(video.desc || ""),
          vod_play_sources: [
            {
              name: "B站视频",
              episodes,
            },
          ],
        },
      ],
    };
  } catch (error) {
    logError("详情获取失败", error);
    return { list: [] };
  }
}

async function play(params, context = {}) {
  let playId = params.playId || "";
  const flag = params.flag || "";

  if (!playId) {
    return { urls: [], parse: 1, header: {} };
  }

  const idParts = playId.split("_");
  if (idParts.length < 2) {
    return {
      urls: [{ name: "播放", url: playId }],
      parse: /\.(m3u8|mp4|flv)$/i.test(playId) ? 0 : 1,
      header: {}
  };
  }

  const avid = idParts[0];
  const cid = idParts[1];
  const loggedIn = isLoggedIn();
  const dashProxyUrl = loggedIn ? buildDashProxyUrl(params, context, avid, cid) : "";

  const qualityList = loggedIn
    ? [127, 126, 125, 120, 116, 112, 80, 74, 64, 32, 16]
    : [80, 64, 32, 16];

  const headers = {
    ...BILI_HEADERS,
    Referer: `https://www.bilibili.com/video/av${avid}`,
    Origin: "https://www.bilibili.com",
  };

  const qualitySet = new Set();
  const availableQualities = [];
  let dashProxyAdded = false;

  if (dashProxyUrl) {
    availableQualities.push({
      name: "DASH(代理)",
      url: dashProxyUrl,
      qn: 1000,
      isDashProxy: true,
      audioUrl: "",
    });
    dashProxyAdded = true;
  }

  for (const qn of qualityList) {
    const useDash = qn > 116;
    try {
      const { data } = await axios.get("https://api.bilibili.com/x/player/playurl", {
        headers,
        params: {
          avid,
          cid,
          qn,
          fnval: useDash ? 4048 : 1,
          fourk: qn >= 120 ? 1 : 0,
          ...(!loggedIn ? { try_look: 1 } : {}),
        },
      });

      if (data?.code !== 0 || !data?.data) continue;

      const payload = data.data;
      const actualQn = payload.quality || qn;
      if (qualitySet.has(actualQn)) continue;
      qualitySet.add(actualQn);

      if (payload.dash?.video?.length) {
        if (loggedIn && !dashProxyAdded) {
          availableQualities.push({
            name: "DASH(代理)",
            url: buildDashDataUrl(payload.dash),
            qn: 1000,
            isDashProxy: true,
            audioUrl: "",
          });
          dashProxyAdded = true;
        }

        const bestVideo = [...payload.dash.video].sort((a, b) => {
          if ((b.id || 0) !== (a.id || 0)) return (b.id || 0) - (a.id || 0);
          if ((b.bandwidth || 0) !== (a.bandwidth || 0)) return (b.bandwidth || 0) - (a.bandwidth || 0);
          return (b.width || 0) - (a.width || 0);
        })[0];

        const bestAudio = [...(payload.dash.audio || [])].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];

        if (bestVideo) {
          availableQualities.push({
            name: QUALITY_NAME_MAP[actualQn] || `DASH ${bestVideo.width || "?"}p`,
            url: bestVideo.base_url || bestVideo.baseUrl,
            qn: actualQn,
            audioUrl: bestAudio?.base_url || bestAudio?.baseUrl || "",
          });
        }
      } else if (payload.durl?.[0]?.url) {
        availableQualities.push({
          name: QUALITY_NAME_MAP[actualQn] || `画质${actualQn}`,
          url: payload.durl[0].url,
          qn: actualQn,
          audioUrl: "",
        });
      }
    } catch {
      // 忽略单个画质异常，继续尝试其他画质
    }
  }

  if (availableQualities.length === 0) {
    return {
      urls: [{ name: "播放", url: playId }],
      parse: 1,
      header: headers};
  }

  availableQualities.sort((a, b) => b.qn - a.qn);

  const urls = availableQualities.map((q) => ({
    name: q.name,
    url: q.url,
  }));

  const response = {
    urls,
    parse: 0,
    header: {
      "User-Agent": headers["User-Agent"],
      Referer: headers.Referer,
      Origin: headers.Origin
    },
    danmaku: [{ name: "B站弹幕", url: `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}` }]};

  if (availableQualities[0]?.audioUrl) {
    response.extra = { audio: availableQualities[0].audioUrl };
  }

  return response;
}

async function proxy(params = {}) {
  const ids = params.ids || params.playId || params.id || "";
  const idParts = String(ids).split("_");
  if (idParts.length < 2) return "";

  const avid = idParts[0];
  const cid = idParts[1];
  const qn = parseInt(params.qn, 10) || 127;
  const headers = {
    ...BILI_HEADERS,
    Referer: `https://www.bilibili.com/video/av${avid}`,
    Origin: "https://www.bilibili.com",
  };

  try {
    const { data } = await axios.get("https://api.bilibili.com/x/player/playurl", {
      headers,
      params: {
        avid,
        cid,
        qn,
        fnval: parseInt(params.fnval, 10) || 4048,
        fourk: params.fourk == null ? 1 : params.fourk,
        ...(!isLoggedIn() ? { try_look: 1 } : {}),
      },
    });

    if (data?.code === 0 && data?.data?.dash) {
      return buildMpd(data.data.dash);
    }
    return "";
  } catch (error) {
    logError("DASH代理获取失败", error);
    return "";
  }
}

module.exports = {
  home,
  category,
  search,
  detail,
  play,
  proxy,
};

const runner = require("spider_runner");
runner.run(module.exports);
