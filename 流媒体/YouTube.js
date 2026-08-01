// @name YouTube
// @author OmniBox
// @description YouTube影视源，支持分组分类、二级筛选、搜索、播放列表与视频播放
// @dependencies: axios
// @version 1.1.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/流媒体/YouTube.js

const axios = require("axios");
const OmniBox = require("omnibox_sdk");

const UA = "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36";
const INNERTUBE_API_KEY = "AIzaSyAO_FJ-m9NdzYF_YpX6Y6F3T_ZzP3e4A";
const INNERTUBE_CONTEXT = { client: { clientName: "WEB", clientVersion: "2.20240320.00.00" } };

const DEFAULT_GL = process.env.YTB_GL || "CN";
const DEFAULT_HL = process.env.YTB_HL || "zh-CN";

const http = axios.create({ timeout: 30000, headers: { "User-Agent": UA } });

function logInfo(msg, data) {
  OmniBox.log("info", `[YouTube] ${msg}${data ? `: ${JSON.stringify(data)}` : ""}`);
}

function logError(msg, err) {
  OmniBox.log("error", `[YouTube] ${msg}: ${err?.message || err}`);
}

const defaultGroups = [
  { id: "group_drama", name: "电视剧", order: 1 },
  { id: "group_movie", name: "电影", order: 2 },
  { id: "group_variety", name: "综艺", order: 3 },
  { id: "group_anime", name: "动漫", order: 4 },
  { id: "group_doc", name: "纪录片", order: 5 },
  { id: "group_music", name: "音乐", order: 6 },
  { id: "group_short", name: "短剧", order: 7 },
];

const defaultCategories = [
  { id: "cat_cdrama", name: "中国电视", groupId: "group_drama", query: "中剧独播", type: "search", order: 1, playlistOnly: true },
  { id: "cat_movie", name: "中国电影", groupId: "group_movie", query: "最新电影", type: "search", order: 1, playlistOnly: false },
  { id: "cat_variety", name: "中国综艺", groupId: "group_variety", query: "喜剧综艺", type: "search", order: 1, playlistOnly: true },
  { id: "cat_anime", name: "中国动漫", groupId: "group_anime", query: "中国动漫", type: "search", order: 1, playlistOnly: true },
  { id: "cat_doc", name: "中国纪录", groupId: "group_doc", query: "中国纪录", type: "search", order: 1, playlistOnly: true },
  { id: "cat_music", name: "中国音乐", groupId: "group_music", query: "华语音乐", type: "search", order: 1, playlistOnly: false },
  { id: "cat_short", name: "中国短剧", groupId: "group_short", query: "中国短剧", type: "search", order: 1, playlistOnly: true },
];

const defaultFilters = [
  { id: "filter_action", name: "动作片", categoryId: "cat_movie", query: "动作电影", order: 1, playlistOnly: false },
  { id: "filter_scifi", name: "科幻片", categoryId: "cat_movie", query: "科幻电影", order: 2, playlistOnly: false },
  { id: "filter_romance", name: "爱情片", categoryId: "cat_movie", query: "爱情电影", order: 3, playlistOnly: false },
  { id: "filter_comedy", name: "喜剧片", categoryId: "cat_movie", query: "喜剧电影", order: 4, playlistOnly: false },
  { id: "filter_horror", name: "恐怖片", categoryId: "cat_movie", query: "恐怖电影", order: 5, playlistOnly: false },
  { id: "filter_thriller", name: "悬疑片", categoryId: "cat_movie", query: "悬疑电影", order: 6, playlistOnly: false },
  { id: "filter_cdrama_tencent", name: "腾讯【剧】", categoryId: "cat_cdrama", query: "腾讯电视剧", order: 1, playlistOnly: true },
  { id: "filter_cdrama_mgtv", name: "芒果【剧】", categoryId: "cat_cdrama", query: "芒果电视剧", order: 2, playlistOnly: true },
  { id: "filter_cdrama_iqiyi", name: "奇艺【剧】", categoryId: "cat_cdrama", query: "爱奇艺电视剧", order: 3, playlistOnly: true },
  { id: "filter_cdrama_youku", name: "优酷【剧】", categoryId: "cat_cdrama", query: "优酷电视剧", order: 4, playlistOnly: true },
  { id: "filter_cdrama_new", name: "华策【剧】", categoryId: "cat_cdrama", query: "华策影视官方频道", order: 5, playlistOnly: true },
  { id: "filter_doc_cctv", name: "CCTV纪录【记录】", categoryId: "cat_doc", query: "CCTV纪录", order: 1, playlistOnly: true },
  { id: "filter_doc_natgeo", name: "国家地理【记录】", categoryId: "cat_doc", query: "国家地理", order: 2, playlistOnly: true },
  { id: "filter_variety_tencent", name: "腾讯【综艺】", categoryId: "cat_variety", query: "腾讯综艺", order: 1, playlistOnly: true },
  { id: "filter_variety_mgtv", name: "芒果【综艺】", categoryId: "cat_variety", query: "芒果综艺", order: 2, playlistOnly: true },
  { id: "filter_variety_iqiyi", name: "奇艺【综艺】", categoryId: "cat_variety", query: "爱奇艺综艺", order: 3, playlistOnly: true },
  { id: "filter_variety_youku", name: "优酷【综艺】", categoryId: "cat_variety", query: "优酷综艺", order: 4, playlistOnly: true },
];

function extractInitialData(html) {
  const match = html.match(/var ytInitialData = ({.+?});/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    logError("解析 ytInitialData 失败", e);
    return null;
  }
}

async function searchVideos(query, page = 1, includePlaylists = true, filterSp = "", playlistOnly = false, gl = DEFAULT_GL, hl = DEFAULT_HL) {
  let isToken = typeof page === "string" && page.length > 20;
  let results = [];
  let nextPageToken = "";

  const parseItems = (items) => {
    if (!items) return;

    const walk = (obj) => {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        obj.forEach(walk);
        return;
      }

      const list = obj.contents || [];
      if (obj.itemSectionRenderer) {
        list.push(...(obj.itemSectionRenderer.contents || []));
      }

      if (!playlistOnly && obj.videoRenderer) {
        const v = obj.videoRenderer;
        results.push({
          vod_id: v.videoId,
          vod_name: v.title?.runs?.[0]?.text || "Unknown",
          vod_pic: v.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || "",
          vod_remarks: v.lengthText?.simpleText || "",
        });
      }

      if (includePlaylists && (obj.playlistRenderer || (obj.lockupViewModel && obj.lockupViewModel.contentType === "LOCKUP_CONTENT_TYPE_PLAYLIST"))) {
        const pId = obj.playlistRenderer?.playlistId || obj.lockupViewModel?.contentId;
        const title = obj.playlistRenderer?.title?.simpleText || obj.lockupViewModel?.metadata?.lockupMetadataViewModel?.title?.content || "Unknown";
        if (pId) {
          results.push({
            vod_id: pId,
            vod_name: title,
            vod_pic: obj.playlistRenderer?.thumbnails?.[0]?.thumbnails?.[0]?.url || obj.lockupViewModel?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources?.[0]?.url || "",
            vod_remarks: "播放列表",
          });
        }
      }

      if (obj.continuationItemRenderer) {
        nextPageToken = obj.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || nextPageToken;
      }

      for (let k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) walk(obj[k]);
      }
    };

    if (Array.isArray(items)) items.forEach(walk); else walk(items);
  };

  const isNumericPage = (p) => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 1 && String(n) === String(p);
  };

  try {
    if (isToken) {
      const resp = await axios.post(
        `https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_API_KEY}`,
        { context: INNERTUBE_CONTEXT, continuation: page },
        { headers: { "User-Agent": UA, "Content-Type": "application/json" }, timeout: 30000 }
      );
      const contItems = resp.data.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction?.continuationItems;
      parseItems(contItems);
    } else if (isNumericPage(page) && Number(page) > 1) {
      const pageNum = Number(page);

      let url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&gl=${gl}&hl=${hl}`;
      if (playlistOnly) {
        url += `&sp=EgIQAw%253D%253D`;
      } else if (filterSp) {
        url += `&sp=${filterSp}`;
      }
      logInfo("搜索请求", { url, page: 1, gl, hl });

      const firstRes = await http.get(url);
      const firstData = extractInitialData(firstRes.data);
      if (!firstData) return { list: [], token: "" };

      const firstItems = firstData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
      parseItems(firstItems);
      let token = nextPageToken;

      let pageResults = results;
      for (let i = 2; i <= pageNum; i += 1) {
        if (!token) break;
        const resp = await axios.post(
          `https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_API_KEY}`,
          { context: INNERTUBE_CONTEXT, continuation: token },
          { headers: { "User-Agent": UA, "Content-Type": "application/json" }, timeout: 30000 }
        );
        const contItems = resp.data.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction?.continuationItems;
        results = [];
        nextPageToken = "";
        parseItems(contItems);
        pageResults = results;
        token = nextPageToken;
      }

      results = pageResults;
      nextPageToken = token || nextPageToken;
    } else {
      let url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&gl=${gl}&hl=${hl}`;
      if (playlistOnly) {
        url += `&sp=EgIQAw%253D%253D`;
      } else if (filterSp) {
        url += `&sp=${filterSp}`;
      }
      logInfo("搜索请求", { url, gl, hl });

      const response = await http.get(url);
      const data = extractInitialData(response.data);
      if (!data) return { list: [], token: "" };

      const items = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
      parseItems(items);
      nextPageToken = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.find(i => i.continuationItemRenderer)?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || nextPageToken;
    }

    logInfo("搜索完成", { query, gl, hl, count: results.length, hasToken: !!nextPageToken });
    return { list: results, token: nextPageToken };
  } catch (error) {
    logError("搜索请求失败", error);
    return { list: [], token: "" };
  }
}

async function home(params = {}) {
  const groups = defaultGroups;
  const categories = defaultCategories;
  const filters = defaultFilters;

  const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
  const classList = [];
  for (const group of sortedGroups) {
    const groupCats = categories.filter(c => c.groupId === group.id).sort((a, b) => a.order - b.order);
    groupCats.forEach(cat => {
      classList.push({ type_id: cat.id, type_name: cat.name });
    });
  }
  const ungrouped = categories.filter(c => !c.groupId).sort((a, b) => a.order - b.order);
  ungrouped.forEach(cat => {
    classList.push({ type_id: cat.id, type_name: cat.name });
  });

  const filtersObj = {};
  categories.forEach(cat => {
    const catFilters = filters.filter(f => f.categoryId === cat.id).sort((a, b) => a.order - b.order);
    if (catFilters.length > 0) {
      const values = [{ name: "全部", value: "" }, ...catFilters.map(f => ({ name: f.name, value: f.id }))];
      filtersObj[cat.id] = [
        {
          key: "filter",
          name: "筛选",
          init: "",
          value: values,
        },
      ];
    }
  });

  logInfo("首页筛选样例", {
    sampleKey: Object.keys(filtersObj)[0],
    sampleValue: filtersObj[Object.keys(filtersObj)[0]],
  });

  let list = [];
  try {
    const res = await searchVideos(defaultCategories[0].query, 1, true, "", defaultCategories[0].playlistOnly, DEFAULT_GL, DEFAULT_HL);
    list = res.list.slice(0, 20);
  } catch (e) {
    logError("首页推荐获取失败", e);
  }

  return { class: classList, filters: filtersObj, list };
}

async function category(params = {}) {
  const categoryId = params.categoryId || params.type_id || "";
  const page = params.page || "1";

  const filters = params.filters || params.extend || {};
  const filterValue = filters.filter || params.filter || "";
  const sp = filters.sp || params.sp || "";
  const gl = filters.gl || params.gl || DEFAULT_GL;
  const hl = filters.hl || params.hl || DEFAULT_HL;

  logInfo("分类加载", { categoryId, page, filter: filterValue, sp, gl, hl });

  const category = defaultCategories.find(c => c.id === categoryId);
  if (!category) return { list: [], page: 1, pagecount: 1, limit: 20, total: 0 };

  let query = category.query;
  let playlistOnly = category.playlistOnly || false;

  if (filterValue && filterValue !== "") {
    const selectedFilter = defaultFilters.find(f => f.id === filterValue && f.categoryId === categoryId);
    if (selectedFilter) {
      query = selectedFilter.query || filterValue;
      playlistOnly = selectedFilter.playlistOnly || false;
    } else {
      query = filterValue;
    }
  }

  const res = await searchVideos(query, page, true, sp || "", playlistOnly, gl, hl);

  const pageNum = typeof page === "string" && page.length > 20 ? 1 : Number(page) || 1;

  logInfo("分类结果样例", {
    count: res.list.length,
    hasToken: !!res.token,
    sample: res.list.slice(0, 2),
  });

  return {
    list: res.list,
    page: pageNum,
    pagecount: res.token ? 999 : pageNum,
    limit: 20,
    total: res.list.length,
  };
}

function parsePlaylistVideos(initialData) {
  const episodes = [];
  if (!initialData) return episodes;

  const playlistContents =
    initialData?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.richGridRenderer?.contents ||
    initialData?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents ||
    [];

  for (const item of playlistContents) {
    const renderer = item.playlistVideoRenderer || item.richItemRenderer?.content?.videoRenderer;
    if (!renderer) continue;

    const videoId = renderer.videoId;
    if (!videoId) continue;

    const name = renderer.title?.runs?.[0]?.text || renderer.title?.simpleText || `第${episodes.length + 1}集`;
    const lengthText = renderer.lengthText?.simpleText || renderer.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || "";

    episodes.push({
      name: lengthText ? `${name} [${lengthText}]` : name,
      playId: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }

  return episodes;
}

async function fetchPlaylistEpisodes(playlistId) {
  try {
    const url = `https://www.youtube.com/playlist?list=${playlistId}`;
    const response = await http.get(url);
    const data = extractInitialData(response.data);
    const episodes = parsePlaylistVideos(data);

    const continuationToken = extractPlaylistContinuation(data);
    if (continuationToken && episodes.length < 200) {
      const moreEpisodes = await fetchPlaylistContinuation(continuationToken, 200 - episodes.length);
      episodes.push(...moreEpisodes);
    }

    return episodes;
  } catch (e) {
    logError("获取播放列表集数失败", e);
    return [];
  }
}

function extractPlaylistContinuation(initialData) {
  const contents =
    initialData?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.richGridRenderer?.contents ||
    initialData?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents ||
    [];

  for (const item of contents) {
    const token = item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (token) return token;
  }
  return "";
}

async function fetchPlaylistContinuation(token, maxCount) {
  const episodes = [];
  let currentToken = token;

  while (currentToken && episodes.length < maxCount) {
    try {
      const resp = await axios.post(
        `https://www.youtube.com/youtubei/v1/browse?key=${INNERTUBE_API_KEY}`,
        { context: INNERTUBE_CONTEXT, continuation: currentToken },
        { headers: { "User-Agent": UA, "Content-Type": "application/json" }, timeout: 30000 }
      );

      const contItems = resp.data.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems || [];
      for (const item of contItems) {
        const renderer = item.playlistVideoRenderer || item.richItemRenderer?.content?.videoRenderer;
        if (!renderer) continue;

        const videoId = renderer.videoId;
        if (!videoId) continue;

        const name = renderer.title?.runs?.[0]?.text || renderer.title?.simpleText || `第${episodes.length + 1}集`;
        const lengthText = renderer.lengthText?.simpleText || renderer.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || "";

        episodes.push({
          name: lengthText ? `${name} [${lengthText}]` : name,
          playId: `https://www.youtube.com/watch?v=${videoId}`,
        });

        if (episodes.length >= maxCount) break;
      }

      let nextToken = "";
      for (const item of contItems) {
        const t = item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        if (t) { nextToken = t; break; }
      }
      currentToken = nextToken;
    } catch (e) {
      logError("获取播放列表续页失败", e);
      break;
    }
  }

  return episodes;
}

async function detail(params = {}) {
  const videoId = params.videoId || params.vod_id || "";
  if (!videoId) return { list: [] };

  logInfo("详情加载", { videoId });

  const isPlaylist = videoId.startsWith("PL") || videoId.startsWith("VL") || videoId.startsWith("OLAK");
  let title = isPlaylist ? "YouTube播放列表" : "YouTube视频";
  let thumb = isPlaylist ? "" : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  let desc = "";
  let episodeCount = 0;

  if (isPlaylist) {
    try {
      const url = `https://www.youtube.com/playlist?list=${videoId}`;
      const response = await http.get(url);
      const data = extractInitialData(response.data);
      if (data?.metadata?.playlistMetadataRenderer) {
        title = data.metadata.playlistMetadataRenderer.title || title;
      }
      const headerRenderer = data?.header?.playlistHeaderRenderer;
      if (headerRenderer) {
        desc = headerRenderer.descriptionText?.simpleText || headerRenderer.secondSubtitle?.simpleText || "";
        thumb = headerRenderer.playlistHeaderBanner?.heroPlaylistThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || thumb;
      }
    } catch (e) {}
  } else {
    try {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const response = await http.get(url);
      const data = extractInitialData(response.data);
      if (data?.contents?.twoColumnWatchNextResults?.results?.results?.contents) {
        const contents = data.contents.twoColumnWatchNextResults.results.results.contents;
        for (const item of contents) {
          if (item.videoPrimaryInfoRenderer) {
            title = item.videoPrimaryInfoRenderer.title?.runs?.[0]?.text || title;
          }
          if (item.videoSecondaryInfoRenderer) {
            desc = item.videoSecondaryInfoRenderer.description?.bodyText?.simpleText ||
                   item.videoSecondaryInfoRenderer.attributedDescriptionBodyText?.content || "";
          }
        }
      }
    } catch (e) {}
  }

  let playSources = [];
  if (isPlaylist) {
    const episodes = await fetchPlaylistEpisodes(videoId);
    episodeCount = episodes.length;
    playSources = [{
      name: "YouTube",
      episodes: episodes.length > 0 ? episodes : [{ name: "播放列表", playId: `https://www.youtube.com/playlist?list=${videoId}` }],
    }];
  } else {
    const playUrl = `https://www.youtube.com/watch?v=${videoId}`;
    playSources = [{
      name: "YouTube",
      episodes: [{ name: "播放", playId: playUrl }],
    }];
  }

  return {
    list: [{
      vod_id: videoId,
      vod_name: title,
      vod_pic: thumb,
      vod_remarks: isPlaylist ? (episodeCount > 0 ? `共${episodeCount}集` : "播放列表") : "视频",
      vod_content: desc,
      vod_play_sources: playSources,
    }],
  };
}

async function search(params = {}) {
  const keyword = params.keyword || params.wd || "";
  const page = params.page || "1";

  const filters = params.filters || params.extend || {};
  const filterValue = filters.filter || params.filter || "";
  const sp = filters.sp || params.sp || "";
  const gl = filters.gl || params.gl || DEFAULT_GL;
  const hl = filters.hl || params.hl || DEFAULT_HL;

  logInfo("搜索开始", { keyword, page, filter: filterValue, sp, gl, hl });

  let query = keyword;
  let playlistOnly = false;
  if (filterValue && filterValue !== "") {
    const selectedFilter = defaultFilters.find(f => f.id === filterValue);
    if (selectedFilter) {
      query = selectedFilter.query || filterValue;
      playlistOnly = selectedFilter.playlistOnly || false;
    } else {
      query = filterValue;
    }
  }

  const res = await searchVideos(query, page, true, sp || "", playlistOnly, gl, hl);

  const pageNum = typeof page === "string" && page.length > 20 ? 1 : Number(page) || 1;

  logInfo("搜索结果样例", {
    count: res.list.length,
    hasToken: !!res.token,
    sample: res.list.slice(0, 2),
  });

  return {
    list: res.list,
    page: pageNum,
    pagecount: res.token ? 999 : pageNum,
    limit: 20,
    total: res.list.length,
  };
}

async function play(params = {}) {
  const playId = params.playId || params.id || "";
  const flag = params.flag || "";

  if (!playId) return { urls: [], parse: 1 };

  logInfo("播放解析", { playId });

  let vid = playId;

  if (vid.startsWith("http")) {
    if (vid.includes("/playlist?list=")) {
      return {
        urls: [{ name: "YouTube播放列表", url: vid }],
        parse: 0,
        header: { "User-Agent": UA }};
    }

    const urlMatch = vid.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (urlMatch && urlMatch[1]) {
      vid = urlMatch[1];
    } else {
      return {
        urls: [{ name: "播放", url: vid }],
        parse: 0,
        header: { "User-Agent": UA }};
    }
  }

  if (vid.startsWith("PL") || vid.startsWith("VL") || vid.startsWith("OLAK")) {
    const url = `https://www.youtube.com/playlist?list=${vid}`;
    return {
      urls: [{ name: "YouTube播放列表", url }],
      parse: 0,
      header: { "User-Agent": UA }};
  }

  if (!/[a-zA-Z0-9_-]{11}/.test(vid)) {
    return {
      urls: [{ name: "播放", url: vid }],
      parse: 0,
      header: { "User-Agent": UA }};
  }

  const watchUrl = `https://www.youtube.com/watch?v=${vid}`;
  return {
    urls: [{ name: "YouTube", url: watchUrl }],
    parse: 0,
    header: { "User-Agent": UA }};
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
