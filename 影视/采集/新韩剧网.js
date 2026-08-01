// @name 新韩剧网
// @author Monica
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: cheerio, crypto-js
// @version 1.1.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/新韩剧网.js

const OmniBox = require("omnibox_sdk");
const cheerio = require("cheerio");
const CryptoJS = require("crypto-js");

const hanjuConfig = {
    host: "https://www.9hanju.com",
    headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36",
        "Referer": "https://www.hanju7.com/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "keep-alive",
        "Cache-Control": "max-age=0",
        "Upgrade-Insecure-Requests": "1"
    }
};

const DEFAULT_PIC = "https://youke2.picui.cn/s1/2025/12/21/694796745c0c6.png";
const DANMU_API = process.env.DANMU_API || "";

// ==========================================================================
// 日志工具
// ==========================================================================
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[新韩剧网-DEBUG] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[新韩剧网-DEBUG] ${message}: ${error?.message || error}`);
};

// ============================================================================
// 刮削与弹幕辅助函数
// ============================================================================
const encodeMeta = (obj) => {
    try { return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64"); } 
    catch { return ""; }
};

const decodeMeta = (str) => {
    try { return JSON.parse(Buffer.from(str || "", "base64").toString("utf8") || "{}"); } 
    catch { return {}; }
};

function preprocessTitle(title) {
    if (!title) return "";
    return title
        .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
        .replace(/[hH]\.?26[45]/g, " ")
        .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
        .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
}

function chineseToArabic(cn) {
    const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    if (!isNaN(cn)) return parseInt(cn);
    if (cn.length === 1) return map[cn] || cn;
    if (cn.length === 2) {
        if (cn[0] === '十') return 10 + map[cn[1]];
        if (cn[1] === '十') return map[cn[0]] * 10;
    }
    if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
    return cn;
}

function extractEpisode(title) {
    if (!title) return "";
    const processedTitle = preprocessTitle(title).trim();
    const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
    if (cnMatch) return String(chineseToArabic(cnMatch[1]));
    const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
    if (seMatch) return seMatch[1];
    const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
    if (epMatch) return epMatch[1];
    const bracketMatch = processedTitle.match(/[\[\(【(](\d{1,3})[\]\)】)]/);
    if (bracketMatch) {
        const num = bracketMatch[1];
        if (!["720", "1080", "480"].includes(num)) return num;
    }
    return "";
}

function buildFileNameForDanmu(vodName, episodeTitle) {
    if (!vodName) return "";
    if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') return vodName;
    const digits = extractEpisode(episodeTitle);
    if (digits) {
        const epNum = parseInt(digits, 10);
        if (epNum > 0) {
            return epNum < 10 ? `${vodName} S01E0${epNum}` : `${vodName} S01E${epNum}`;
        }
    }
    return vodName;
}

const buildScrapedDanmuFileName = (scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) => {
    if (!scrapeData) {
        return buildFileNameForDanmu(fallbackVodName, fallbackEpisodeName);
    }
    if (scrapeType === "movie") {
        return scrapeData.title || fallbackVodName;
    }
    const title = scrapeData.title || fallbackVodName;
    const seasonAirYear = scrapeData.seasonAirYear || "";
    const seasonNumber = mapping?.seasonNumber || 1;
    const episodeNumber = mapping?.episodeNumber || 1;
    return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
};

function buildScrapedEpisodeName(scrapeData, mapping, originalName) {
    if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
        return originalName;
    }
    if (mapping.episodeName) {
        const epName = mapping.episodeNumber + "." + mapping.episodeName;
        return epName;
    }
    if (scrapeData && Array.isArray(scrapeData.episodes)) {
        const hit = scrapeData.episodes.find(
            (ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber
        );
        if (hit?.name) return `${hit.episodeNumber}.${hit.name}`;
    }
    return originalName;
}

const matchDanmu = async (fileName) => {
    if (!DANMU_API || !fileName) return [];

    try {
        logInfo(`匹配弹幕: ${fileName}`);
        const matchUrl = `${DANMU_API}/api/v2/match`;
        const response = await OmniBox.request(matchUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: JSON.stringify({ fileName }),
        });

        if (response.statusCode !== 200) {
            logInfo(`弹幕匹配失败: HTTP ${response.statusCode}`);
            return [];
        }

        const matchData = JSON.parse(response.body);
        if (!matchData.isMatched) {
            logInfo("弹幕未匹配到");
            return [];
        }

        const matches = matchData.matches || [];
        if (matches.length === 0) return [];

        const firstMatch = matches[0];
        const episodeId = firstMatch.episodeId;
        const animeTitle = firstMatch.animeTitle || "";
        const episodeTitle = firstMatch.episodeTitle || "";
        if (!episodeId) return [];

        let danmakuName = "弹幕";
        if (animeTitle && episodeTitle) {
            danmakuName = `${animeTitle} - ${episodeTitle}`;
        } else if (animeTitle) {
            danmakuName = animeTitle;
        } else if (episodeTitle) {
            danmakuName = episodeTitle;
        }

        return [{
            name: danmakuName,
            url: `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`,
        }];
    } catch (error) {
        logInfo(`弹幕匹配失败: ${error.message}`);
        return [];
    }
};

// ============================================================================
// 网络请求与核心逻辑
// ============================================================================
const fetchHtml = async (url, options = {}) => {
    try {
        const res = await OmniBox.request(url, {
            method: options.method || "GET",
            headers: options.headers || hanjuConfig.headers,
            body: options.body,
            timeout: 10000,
            gzip: true 
        });
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
        return cheerio.load(res.body);
    } catch (e) {
        logError(`请求失败: ${url}`, e);
        throw e;
    }
};

const getClasses = () => {
    return [
        { type_id: "1", type_name: "韩剧" },
        { type_id: "3", type_name: "韩国电影" },
        { type_id: "4", type_name: "韩国综艺" },
        { type_id: "hot", type_name: "排行榜" },
        { type_id: "new", type_name: "最新更新" }
    ];
};

const getCleanText = (el) => {
    let text = "";
    el.contents().each((_, node) => {
        if (node.type === 'text') text += node.data;
    });
    return text.trim();
};

const normalizePic = (pic) => {
    const value = String(pic || "").trim();
    if (!value) return "";
    if (value.startsWith("//")) return `https:${value}`;
    if (/^https?:\/\//i.test(value)) return value;
    try { return new URL(value, hanjuConfig.host).toString(); }
    catch { return value; }
};

const getPicFromDetail = async (id) => {
    try {
        const detailUrl = /^https?:\/\//i.test(String(id || "")) ? String(id) : `${hanjuConfig.host}${id}`;
        const $ = await fetchHtml(detailUrl);
        const pic = $("div.detail div.pic img").attr("data-original") || $("div.detail div.pic img").attr("src") || "";
        return normalizePic(pic) || DEFAULT_PIC;
    } catch (error) {
        logInfo(`详情封面获取失败: ${id}: ${error.message}`);
        return DEFAULT_PIC;
    }
};

const mapWithConcurrency = async (items, limit, mapper) => {
    const values = Array.from(items || []);
    const results = new Array(values.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
        while (cursor < values.length) {
            const index = cursor++;
            results[index] = await mapper(values[index], index);
        }
    });
    await Promise.all(workers);
    return results;
};

const normalizeSniffUrls = (result, defaultName = "嗅探线路") => {
    const urls = [];
    const seen = new Set();
    const append = (item) => {
        const value = typeof item === "string" ? item : (item?.url || item?.playUrl || item?.src || "");
        const url = String(value || "").trim();
        if (!url || seen.has(url)) return;
        seen.add(url);
        urls.push({ name: String(item?.name || defaultName), url });
    };
    if (Array.isArray(result?.urls)) result.urls.forEach(append);
    if (!urls.length) append(result);
    return urls;
};

async function home(params) {
    try {
        logInfo("进入首页");
        const $ = await fetchHtml(`${hanjuConfig.host}`);
        const list = [];
        $("div.list ul li").slice(0, 100).each((_, el) => {
            const a = $(el).find("a");
            const href = a.attr("href");
            if (href) {
                list.push({
                    vod_id: href,
                    vod_name: getCleanText(a) || a.attr("title"),
                    vod_pic: normalizePic(a.attr("data-original")) || DEFAULT_PIC,
                    vod_remarks: $(el).find("span").first().text() || ""
                });
            }
        });
        logInfo(`首页获取到 ${list.length} 个项目`);
        return { class: getClasses(), filters: {}, list: list };
    } catch (e) {
        logError("首页请求失败", e);
        return { class: getClasses(), filters: {}, list: [] };
    }
}

async function category(params) {
    const tid = params.categoryId;
    const pg = Math.max(1, parseInt(params.page || 1));

    try {
        logInfo(`请求分类: ${tid}, 页码: ${pg}`);
        if (["hot", "new"].includes(tid)) {
            const $ = await fetchHtml(`${hanjuConfig.host}/${tid}.html`);
            const allItems = $("div.txt ul li, div.list_txt ul li").get();
            const pageSize = 20;
            const total = allItems.length;
            const pageCount = Math.max(1, Math.ceil(total / pageSize));
            const pageItems = allItems.slice((pg - 1) * pageSize, pg * pageSize);
            const list = await mapWithConcurrency(pageItems, 5, async (el) => {
                const a = $(el).find("a").first();
                const href = a.attr("href");
                if (!href) return null;
                return {
                    vod_id: href,
                    vod_name: getCleanText(a) || a.attr("title") || "",
                    vod_pic: await getPicFromDetail(href),
                    vod_remarks: $(el).find("#actor, span").first().text().trim(),
                };
            });
            const filtered = list.filter(Boolean);
            logInfo(`分类 ${tid} 第 ${pg} 页获取到 ${filtered.length} 个项目`);
            return { list: filtered, page: pg, pagecount: pageCount, limit: pageSize, total };
        }

        const $ = await fetchHtml(`${hanjuConfig.host}/list/${tid}---${pg - 1}.html`);
        const list = [];
        $("div.list ul li").each((_, el) => {
            const a = $(el).find("a.tu").first();
            const href = a.attr("href");
            if (!href) return;
            list.push({
                vod_id: href,
                vod_name: a.attr("title") || getCleanText(a),
                vod_pic: normalizePic(a.attr("data-original")) || DEFAULT_PIC,
                vod_remarks: $(el).find("span.tip").text().trim(),
            });
        });
        logInfo(`分类 ${tid} 第 ${pg} 页获取到 ${list.length} 个项目`);
        return { list, page: pg, pagecount: 100, limit: list.length, total: 9999 };
    } catch (e) {
        logError("分类请求失败", e);
        return { list: [], page: pg, pagecount: pg, limit: 0, total: 0 };
    }
}

async function search(params) {
    const keyword = params.keyword || params.wd || "";
    if (!keyword) return { list: [], page: 1, pagecount: 0, total: 0 };

    try {
        logInfo(`搜索关键词: ${keyword}`);
        const formData = `show=searchkey&keyboard=${encodeURIComponent(keyword)}`;
        let searchRes = await OmniBox.request(`${hanjuConfig.host}/search/`, {
            method: "POST",
            headers: {
                ...hanjuConfig.headers,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formData,
            timeout: 15000,
            gzip: true,
        });

        if (Number(searchRes?.statusCode) >= 300 && Number(searchRes?.statusCode) < 400) {
            const location = searchRes?.headers?.location || searchRes?.headers?.Location || "";
            if (!location) return { list: [], page: 1, pagecount: 0, total: 0 };
            const redirectUrl = new URL(location, `${hanjuConfig.host}/search/`).toString();
            const redirectHeaders = { ...hanjuConfig.headers };
            const cookie = searchRes?.headers?.["set-cookie"] || searchRes?.headers?.["Set-Cookie"];
            if (cookie) redirectHeaders.Cookie = Array.isArray(cookie) ? cookie.join("; ") : String(cookie);
            searchRes = await OmniBox.request(redirectUrl, {
                method: "GET",
                headers: redirectHeaders,
                timeout: 15000,
                gzip: true,
            });
        }

        if (Number(searchRes?.statusCode || 200) !== 200) throw new Error(`HTTP ${searchRes?.statusCode || "unknown"}`);
        const $ = cheerio.load(searchRes.body || "");
        const items = $("div.txt ul li").filter((_, el) => $(el).attr("id") !== "t").get();
        const list = await mapWithConcurrency(items, 5, async (el) => {
            const a = $(el).find("p#name a, a").first();
            const href = a.attr("href");
            if (!href) return null;
            return {
                vod_id: href,
                vod_name: a.text().trim().replace(/\(\d+\)$/, ""),
                vod_pic: await getPicFromDetail(href),
                vod_remarks: $(el).find("p#actor, #actor").first().text().trim(),
            };
        });
        const filtered = list.filter(Boolean);
        logInfo(`搜索 "${keyword}" 找到 ${filtered.length} 个结果`);
        return { list: filtered, page: 1, pagecount: 1, total: filtered.length };
    } catch (e) {
        logError("搜索失败", e);
        return { list: [], page: 1, pagecount: 0, total: 0 };
    }
}

async function detail(params) {
    const videoId = params.videoId;

    try {
        logInfo(`请求详情 ID: ${videoId}`);
        const $ = await fetchHtml(hanjuConfig.host + videoId);
        
        const episodes = [];
        $("div.play ul li a").each((_, el) => {
            const name = $(el).text();
            const onclick = $(el).attr("onclick") || "";
            const match = onclick.match(/'(.*?)'/);
            if (match) {
                episodes.push({
                    name: name,
                    playId: match[1] 
                });
            }
        });

        const vodPlaySources = episodes.length > 0 ? [{
            name: $("#playlist").text() || "新韩剧线路",
            episodes: episodes
        }] : [];

        let pic = $("div.detail div.pic img").attr("data-original") || "";
        if (pic && !pic.startsWith("http")) pic = "https:" + pic;
        
        let vodName = $("div.detail div.info dl:eq(0) dd").text();
        let vodContent = $("div.juqing").text().trim();

        // ============================================================================
        // 刮削处理逻辑
        // ============================================================================
        let scrapeData = null;
        let videoMappings = [];
        let scrapeType = "";
        const scrapeCandidates = [];
        
        for (const source of vodPlaySources) {
            for (const ep of source.episodes) {
                const fid = ep.playId;
                if (!fid) continue;
                scrapeCandidates.push({
                    fid: fid,
                    file_id: fid,
                    file_name: ep.name || "正片",
                    name: ep.name || "正片",
                    format_type: "video"
                });
            }
        }

        if (scrapeCandidates.length > 0) {
            try {
                const scrapingResult = await OmniBox.processScraping(videoId, vodName, vodName, scrapeCandidates);
                logInfo("刮削处理完成", { result: scrapingResult || {} });
                const metadata = await OmniBox.getScrapeMetadata(videoId);
                scrapeData = metadata?.scrapeData || null;
                videoMappings = metadata?.videoMappings || [];
                scrapeType = metadata?.scrapeType || "";
                logInfo("刮削元数据读取完成", { hasScrapeData: !!scrapeData, mappingCount: videoMappings.length, scrapeType });
            } catch (error) {
                logError("刮削处理失败", error);
            }
        }

        for (const source of vodPlaySources) {
            for (const ep of source.episodes) {
                const fid = ep.playId;
                const mapping = videoMappings.find((m) => m?.fileId === fid);
                
                let newName = ep.name;
                let seasonNum = 0;
                let episodeNum = 0;
                
                if (mapping) {
                    newName = buildScrapedEpisodeName(scrapeData, mapping, ep.name);
                    seasonNum = mapping.seasonNumber || 0;
                    episodeNum = mapping.episodeNumber || 0;
                    if (newName !== ep.name) {
                        const oldName = ep.name;
                        ep.name = newName;
                        logInfo(`应用刮削后源文件名: ${oldName} -> ${newName}`);
                    }
                }
                
                const meta = { sid: videoId, fid: fid, v: vodName, e: ep.name, s: seasonNum, n: episodeNum };
                ep.playId = `${fid}|||${encodeMeta(meta)}`;
            }

            const hasEpisodeNumber = source.episodes.some(ep => {
                const metaPart = (ep.playId || "").split('|||')[1] || "";
                const meta = decodeMeta(metaPart);
                return meta?.n !== undefined && meta?.n !== 0;
            });
            
            if (hasEpisodeNumber) {
                source.episodes.sort((a, b) => {
                    const metaA = decodeMeta((a.playId || "").split('|||')[1] || "");
                    const metaB = decodeMeta((b.playId || "").split('|||')[1] || "");
                    if (metaA.s !== metaB.s) return metaA.s - metaB.s;
                    return metaA.n - metaB.n;
                });
            }
        }

        logInfo("详情接口返回数据");
        return {
            list: [{
                vod_id: videoId,
                vod_name: scrapeData?.title || vodName,
                vod_pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : pic,
                vod_play_sources: vodPlaySources,
                vod_remarks: $("div.detail div.info dl:eq(4) dd").text(),
                vod_year: $("div.detail div.info dl:eq(5) dd").text(),
                vod_actor: $("div.detail div.info dl:eq(1) dd").text(),
                vod_content: scrapeData?.overview || vodContent
            }]
        };
    } catch (e) {
        logError("详情获取失败", e);
        return { list: [] };
    }
}

async function play(params) {
    const rawPlayIdParam = params.playId;
    const vodId = params.vodId || "";

    let playId = rawPlayIdParam;
    let playMeta = {};
    let vodName = "";
    let episodeName = "";

    if (rawPlayIdParam && rawPlayIdParam.includes("|||")) {
        const parts = rawPlayIdParam.split("|||");
        playId = parts[0];
        playMeta = decodeMeta(parts[1] || "");
        vodName = playMeta.v || "";
        episodeName = playMeta.e || "";
    }
    if (!playId) return { parse: 0, url: "", urls: [], header: {}, headers: {} };

    logInfo(`准备播放 ID: ${playId}`);
    let scrapedDanmuFileName = "";
    let scrapeType = "";
    try {
        const videoIdForScrape = vodId || (playMeta?.sid ? String(playMeta.sid) : "");
        if (videoIdForScrape) {
            const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
            if (metadata?.scrapeData) {
                const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === playMeta?.fid);
                if (metadata.scrapeData.title) vodName = metadata.scrapeData.title;
                if (mapping?.episodeName) episodeName = mapping.episodeName;
                scrapeType = metadata?.scrapeType || "";
                scrapedDanmuFileName = buildScrapedDanmuFileName(metadata.scrapeData, scrapeType, mapping, vodName, episodeName);
            }
        }
    } catch (error) {
        logInfo(`读取刮削元数据失败: ${error.message}`);
    }

    try {
        const res = await OmniBox.request(`${hanjuConfig.host}/u/u1.php?ud=${encodeURIComponent(playId)}`, {
            headers: hanjuConfig.headers,
            timeout: 15000,
            gzip: true,
        });
        if (Number(res?.statusCode || 200) !== 200) throw new Error(`HTTP ${res?.statusCode || "unknown"}`);

        const key = CryptoJS.enc.Utf8.parse("my-to-newhan-2025\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0");
        const base64Data = CryptoJS.enc.Base64.parse(String(res.body || "").trim());
        const iv = CryptoJS.lib.WordArray.create(base64Data.words.slice(0, 4));
        const ciphertext = CryptoJS.lib.WordArray.create(base64Data.words.slice(4));
        const decrypted = CryptoJS.AES.decrypt(
            { ciphertext },
            key,
            { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
        );
        const realUrl = decrypted.toString(CryptoJS.enc.Utf8).trim();
        if (!realUrl) throw new Error("播放地址解密为空");

        let playResponse;
        if (/\.(?:m3u8|mp4|flv|avi|mkv|ts)(?:$|[?#])/i.test(realUrl)) {
            playResponse = {
                parse: 0,
                jx: 0,
                url: realUrl,
                urls: [{ name: "直接播放", url: realUrl }],
                header: hanjuConfig.headers,
                headers: hanjuConfig.headers,
            };
        } else {
            let sniffed = null;
            if (typeof OmniBox.sniffVideo === "function") {
                try { sniffed = await OmniBox.sniffVideo(realUrl, hanjuConfig.headers); }
                catch (error) { logInfo(`服务端嗅探失败: ${error.message}`); }
            }
            const sniffUrls = normalizeSniffUrls(sniffed);
            if (sniffUrls.length) {
                const header = sniffed?.header || sniffed?.headers || hanjuConfig.headers;
                playResponse = {
                    parse: 0,
                    jx: 0,
                    url: sniffUrls[0].url,
                    urls: sniffUrls,
                    header,
                    headers: header,
                };
            } else {
                playResponse = {
                    parse: 1,
                    jx: 1,
                    url: realUrl,
                    urls: [{ name: "浏览器嗅探", url: realUrl }],
                    header: hanjuConfig.headers,
                    headers: hanjuConfig.headers,
                };
            }
        }

        if (DANMU_API && (vodName || params.vodName)) {
            const fallbackFileName = buildFileNameForDanmu(vodName || params.vodName || "", episodeName);
            const danmuFileName = scrapedDanmuFileName || fallbackFileName;
            const danmakuList = await matchDanmu(danmuFileName);
            if (danmakuList.length) playResponse.danmaku = danmakuList;
        }
        return playResponse;
    } catch (e) {
        logError("解析播放失败", e);
        return { parse: 0, jx: 0, url: "", urls: [], header: {}, headers: {} };
    }
}

module.exports = {
    home,
    category,
    search,
    detail,
    play
};

const runner = require("spider_runner");
runner.run(module.exports);
