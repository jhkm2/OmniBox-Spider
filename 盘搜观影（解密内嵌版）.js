/*
 * 📅【观影盘搜】基于盘搜观影 API 的影视插件，支持多网盘搜索、分组、线路解析和播放。
 * 
 * 🔥 主要功能:
 *    - 热搜榜分类（电视剧/电影/短剧/动漫/综艺），数据来自剧盘搜 API
 *    - 观影 API 多网盘检索，按网盘类型分组展示
 *    - 详情页聚合所有网盘结果，自动分组为线路
 *    - TMDB 刮削补充海报和详情信息，并获取剧集详细季信息用于集标题增强
 *    - 网盘驱动解析播放、TVBox列表模式支持，默认关闭，可手动开启
 *    - ✅【新增】多账号负载均衡：支持多个观影 API 账号，自动登录、健康检查、轮询使用
 *    - ✅【新增】状态查看路由：/video/gy_pansou2/status 可查看账号状态和轮询索引
 *    - ✅【新增】性能优化：资源智能排序、链接有效性校验、流式并发解析、小文件线路屏蔽
 *    - ✅【重构】完全内嵌 Gying 客户端，不再依赖外部 Go 服务
 * 
 * ==================================================
 */

const axios = require("axios");
const http = require("http");
const https = require("https");
const dayjs = require("dayjs");
const { CookieJar } = require("tough-cookie");
const { wrapper: axiosCookieJarSupport } = require("axios-cookiejar-support");
const crypto = require("crypto");

// ===================== ⚠️ 重要配置参数 =====================

// 账号配置（请根据实际情况修改）
const ACCOUNTS = [
  // 示例：每个账号对象
  // {
  //   baseUrl: "https://www.xn--wcv59z.com",
  //   username: "your_username",
  //   password: "your_password"
  // },
  // {
  //   baseUrl: "https://www.xn--kivn76b41nnhi.com",
  //   username: "your_username",
  //   password: "your_password"
  // }
];

// 网盘配置（统一标识）
const PAN_ORDER = ['baidu', 'a189', 'quark', 'uc', 'xunlei', 'a139', 'a123', 'a115', 'pikpak', 'ali'];

// TMDB 配置
const USE_TMDB_IMAGE = true;
const TMDB_API_KEY = "**********************";

// 线路限制与并发
const MAX_LINES_PER_PAN = 3;      // 每个网盘最多显示线路数
const MAX_RESOURCES_TO_PARSE = 5;  // 每个网盘解析的最大资源数
const CONCURRENCY_LIMIT = 15;     // 详情页解析并发数
const EARLY_RETURN_THRESHOLD = 6; // 收集到几条线路就提前返回
const SMALL_FILE_THRESHOLD_MB = 200; // 小文件线路屏蔽阈值（MB）

// TVBox列表模式配置
const TVBOX_LIST_MODE = false;      // true: 搜索后显示网盘资源列表(需手动选择), false: 自动解析

// 账号健康检查间隔（毫秒）
const ACCOUNT_HEALTH_CHECK_INTERVAL = 10 * 60 * 1000; // 10分钟

// 热搜榜频道映射（作为一级分类）
const HOT_CHANNELS = [
  { id: "hot_电视剧", name: "热搜榜·电视剧", channel: "电视剧" },
  { id: "hot_电影", name: "热搜榜·电影", channel: "电影" },
  { id: "hot_短剧", name: "热搜榜·短剧", channel: "短剧" },
  { id: "hot_动漫", name: "热搜榜·动漫", channel: "动漫" },
  { id: "hot_综艺", name: "热搜榜·综艺", channel: "综艺" },
];

// 链接校验服务地址（可自行修改或部署）
const LINK_CHECK_URL = "http://192.168.1.101:8774/api/v1/links/check";

// 资源排序调试开关
const SORT_DEBUG = true;

// ===================== 基础配置 =====================
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const DATA_SOURCES = {
  tmdbImage: "https://image.tmdb.org/t/p/w500",
  tmdbApi: "https://api.tmdb.org/3"
};

// ===================== 日志 =====================
let log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

const init = async (server) => {
  if (log.init) return;
  if (server && server.log) {
    log.info = (...args) => server.log.info(args.join(' '));
    log.error = (...args) => server.log.error(args.join(' '));
    log.warn = (...args) => server.log.warn(args.join(' '));
  }
  log.init = true;
};

// ===================== Gying 客户端（内嵌） =====================
class GyingClient {
  constructor(baseUrl, username, password) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.username = username;
    this.password = password;
    this.jar = new CookieJar();
    this.client = axiosCookieJarSupport(axios.create({
      jar: this.jar,
      withCredentials: true,
      headers: {
        'User-Agent': UA
      },
      timeout: 15000,
      // 保持响应数据为原始格式，但axios会自动解析JSON，我们手动处理
    }));
    this.loggedIn = false;
  }

  // 确保数据为字符串
  _ensureString(data) {
    if (typeof data === 'string') return data;
    if (Buffer.isBuffer(data)) return data.toString('utf8');
    if (typeof data === 'object') {
      // 如果是对象，尝试转为 JSON 字符串，但通常我们期望是 HTML 文本
      // 对于登录后的 JSON 响应，我们会单独处理
      return JSON.stringify(data);
    }
    return String(data);
  }

  // 判断是否为机器人验证页
  _isBotChallengePage(body) {
    const str = this._ensureString(body);
    return str.includes('正在确认你是不是机器人') && /const json=/.test(str);
  }

  // 解决机器人验证（根据 gying.go 中的算法）
  async _solveBotChallenge(body, referer) {
    const str = this._ensureString(body);
    const matches = str.match(/const json=(\{.*?\});const jss=/);
    if (!matches) throw new Error('未找到挑战数据');
    const challenge = JSON.parse(matches[1]);
    const { id, challenge: targets, diff, salt } = challenge;

    const remaining = new Map();
    targets.forEach((target, idx) => remaining.set(target.toLowerCase(), idx));

    const nonces = new Array(targets.length).fill(0);
    for (let nonce = 0; nonce <= diff && remaining.size > 0; nonce++) {
      const hash = crypto.createHash('sha256').update(nonce + salt).digest('hex');
      if (remaining.has(hash)) {
        const idx = remaining.get(hash);
        nonces[idx] = nonce;
        remaining.delete(hash);
      }
    }
    if (remaining.size > 0) throw new Error('无法完成验证');

    const form = new URLSearchParams();
    form.append('action', 'verify');
    form.append('id', id);
    nonces.forEach(n => form.append('nonce[]', n));

    const resp = await this.client.post(referer, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    // 验证响应可能是 JSON 对象
    const verifyResp = resp.data;
    if (!verifyResp.success) throw new Error(`验证失败: ${verifyResp.msg || ''}`);
  }

  // 登录流程（三步）
  async login() {
    // 1. 访问登录页获取 PHPSESSID
    const loginPageUrl = `${this.baseUrl}/user/login/`;
    const res1 = await this.client.get(loginPageUrl);
    const body1 = this._ensureString(res1.data);
    if (this._isBotChallengePage(body1)) {
      await this._solveBotChallenge(body1, loginPageUrl);
    }

    // 2. POST 登录
    const loginApi = `${this.baseUrl}/user/login`;
    const formData = `code=&siteid=1&dosubmit=1&cookietime=10506240&username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
    const res2 = await this.client.post(loginApi, formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    // POST 响应为 JSON 对象
    const loginJson = res2.data;
    if (loginJson.code !== 200) {
      throw new Error(`登录失败: ${loginJson.msg || '未知错误'}`);
    }

    // 3. 访问一个详情页触发防爬 cookies
    const warmupUrl = `${this.baseUrl}/mv/wkMn`;
    await this.client.get(warmupUrl);

    this.loggedIn = true;
    return true;
  }

  // 搜索关键词，返回分组后的网盘链接
  async search(keyword) {
    try {
      const searchUrl = `${this.baseUrl}/s/1---1/${encodeURIComponent(keyword)}`;
      let resp = await this.client.get(searchUrl);
      let body = this._ensureString(resp.data);

      // 处理验证页面
      if (this._isBotChallengePage(body)) {
        log.info(`[${this.username}] 检测到挑战页面，尝试解决...`);
        await this._solveBotChallenge(body, searchUrl);
        resp = await this.client.get(searchUrl);
        body = this._ensureString(resp.data);
        if (this._isBotChallengePage(body)) throw new Error('挑战解决后仍为验证页面');
      }

      const match = body.match(/_obj\.search=(\{.*?\});/);
      if (!match) {
        log.error(`[${this.username}] 未找到搜索结果数据，关键词: ${keyword}`);
        log.info(`[${this.username}] 页面片段: ${body.substring(0, 500)}`);
        return [];
      }

      const jsonStr = match[1];
      log.info(`[${this.username}] 搜索结果 JSON 前 300 字符: ${jsonStr.substring(0, 300)}`);

      const searchData = JSON.parse(jsonStr);

      // 健壮性检查（使用小写字段）
      if (!searchData || typeof searchData !== 'object') {
        log.error(`[${this.username}] searchData 无效，关键词: ${keyword}`);
        return [];
      }

      if (!searchData.l || typeof searchData.l !== 'object') {
        log.error(`[${this.username}] 缺少 l 字段，关键词: ${keyword}`);
        return [];
      }

      // 注意：实际字段是 l.i (小写 i)
      if (!Array.isArray(searchData.l.i)) {
        log.error(`[${this.username}] l.i 不是数组，关键词: ${keyword}`);
        return [];
      }

      if (searchData.l.i.length === 0) {
        log.info(`[${this.username}] 关键词 "${keyword}" 未找到任何资源`);
        return [];
      }

      const results = await this._fetchAllDetails(searchData, keyword);
      return results;
    } catch (e) {
      log.error(`[${this.username}] 搜索失败: ${e.message}`);
      return [];
    }
  }
  async _fetchAllDetails(searchData, keyword) {
    try {
      if (!searchData || !searchData.l) {
        log.error(`[${this.username}] 搜索数据无效: searchData 缺少 l 字段`);
        return [];
      }
      const l = searchData.l;
      const ids = l.i;        // 资源ID数组
      const types = l.d;      // 类型数组 (mv/tv/ac等)
      const titles = l.title; // 标题数组

      if (!Array.isArray(ids) || !Array.isArray(types) || !Array.isArray(titles)) {
        log.error(`[${this.username}] 搜索数据字段不完整: ids=${Array.isArray(ids)}, types=${Array.isArray(types)}, titles=${Array.isArray(titles)}`);
        return [];
      }

      if (ids.length === 0) return [];

      const keywordLower = keyword.toLowerCase();
      const validItems = [];
      for (let i = 0; i < ids.length; i++) {
        const title = titles[i] || '';
        if (title.toLowerCase().includes(keywordLower)) {
          validItems.push({ id: ids[i], type: types[i], title, index: i });
        }
      }

      const concurrency = 10;
      const results = [];
      for (let i = 0; i < validItems.length; i += concurrency) {
        const batch = validItems.slice(i, i + concurrency);
        const batchPromises = batch.map(async (item) => {
          try {
            const detail = await this._fetchDetail(item.id, item.type);
            if (detail && detail.code !== 403) {
              const result = this._buildResult(detail, searchData, item.index, keyword);
              if (result.title && result.links.length) return result;
            }
          } catch (e) {
            log.warn(`[${this.username}] 获取详情失败: ${item.id} - ${e.message}`);
          }
          return null;
        });
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(r => r !== null));
      }
      return results;
    } catch (e) {
      log.error(`[${this.username}] 获取详情整体失败: ${e.message}`);
      return [];
    }
  }
  async _fetchDetail(id, type) {
    const detailUrl = `${this.baseUrl}/res/downurl/${type}/${id}`;
    log.info(`[${this.username}] 请求详情: ${detailUrl}`);
    const resp = await this.client.get(detailUrl);
    // 打印详情响应片段（前 500 字符）
    const respStr = JSON.stringify(resp.data, null, 2);
    log.info(`[${this.username}] 详情响应 (前500字符): ${respStr.substring(0, 500)}`);
    const detail = resp.data;
    if (detail.code === 403) throw new Error(`详情返回403: ${id}`);
    return detail;
  }
  _buildResult(detail, searchData, index, keyword) {
    const l = searchData.l;
    const title = l.title[index] || '';
    const links = [];
    const resourceId = l.i ? l.i[index] : 'unknown';

    // 1. 处理 downlist 格式（主要为磁力链接）
    const downlist = detail?.downlist;
    if (downlist && downlist.list && Array.isArray(downlist.list.m)) {
      const mList = downlist.list.m;      // 磁力hash数组
      const tList = downlist.list.t || []; // 标题数组
      const typeA = downlist.type?.a || []; // 清晰度标签

      for (let i = 0; i < mList.length; i++) {
        const hash = mList[i];
        if (!hash) continue;

        const fileName = tList[i] || title;
        const quality = typeA[i] || '';
        const magnetUrl = hash.startsWith('magnet:') ? hash : `magnet:?xt=urn:btih:${hash.toLowerCase()}`;

        links.push({
          type: 'magnet',
          url: magnetUrl,
          password: '',
          name: fileName,
          quality: quality
        });
        // 打印调试信息
        log.info(`[${this.username}] [磁力提取] ${fileName} -> ${magnetUrl}`);
      }
    }

    // 2. 处理 panlist 格式（网盘链接）
    const panlist = detail?.panlist;
    if (panlist && Array.isArray(panlist.url)) {
      for (let i = 0; i < panlist.url.length; i++) {
        let linkURL = panlist.url[i] || '';
        if (!linkURL) continue;

        const typeName = panlist.tname ? panlist.tname[i] : '';
        let password = panlist.p ? panlist.p[i] : '';
        const fileName = panlist.name ? panlist.name[i] : title;

        // 去除URL中的访问码标记
        linkURL = linkURL.replace(/（访问码：.*?）/g, '').replace(/\(访问码：.*?\)/g, '').trim();

        // 尝试从URL提取密码（如 ?pwd=xxxx）
        if (!password) {
          const pwdMatch = linkURL.match(/[?&]pwd=([a-zA-Z0-9]+)/);
          if (pwdMatch) password = pwdMatch[1];
        }

        // 识别网盘类型
        let panType = 'others';
        if (linkURL.includes('pan.quark.cn')) panType = 'quark';
        else if (linkURL.includes('drive.uc.cn')) panType = 'uc';
        else if (linkURL.includes('pan.baidu.com')) panType = 'baidu';
        else if (linkURL.includes('aliyundrive.com') || linkURL.includes('alipan.com')) panType = 'ali';
        else if (linkURL.includes('pan.xunlei.com')) panType = 'xunlei';
        else if (linkURL.includes('cloud.189.cn')) panType = 'a189';
        else if (linkURL.includes('123pan')) panType = 'a123';
        else if (linkURL.includes('123pan')) panType = 'a115';
        else if (linkURL.includes('pikpak')) panType = 'pikpak';
        else panType = typeName || 'others';

        links.push({
          type: panType,
          url: linkURL,
          password: password,
          name: fileName,
          time: panlist.time ? panlist.time[i] : ''
        });
        log.info(`[${this.username}] [网盘提取] [${panType}] ${fileName} -> ${linkURL} (码: ${password || '无'})`);
      }
    }

    if (links.length === 0) {
      log.warn(`[${this.username}] 资源 ${resourceId} (${title}) 未提取到任何有效链接`);
    } else {
      log.info(`[${this.username}] 资源 ${resourceId} 提取完成，共计 ${links.length} 条结果`);
    }

    return { title, links };
  }
}

// ===================== 网盘图标映射 =====================
const panPic = {
  ali: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/ali.jpg",
  quark: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/quark.png",
  uc: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/uc.png",
  xunlei: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/thunder.png",
  a123: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/123.png",
  a189: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/189.png",
  a139: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/139.jpg",
  a115: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/115.jpg",
  baidu: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/baidu.jpg",
  pikpak: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/pikpak.jpg"
};

const panNames = {
  ali: "ali",
  quark: "quark",
  uc: "uc",
  xunlei: "xunlei",
  a123: "a123",
  a189: "a189",
  a139: "a139",
  a115: "a115",
  baidu: "baidu",
  pikpak: "PikPak"
};

// ===================== 替换规则 =====================
const REPLACE_RULES = {
  "4k": "2160P", "4K": "2160P", "2160p": "2160P", "uhd": "2160P",
  "1080p": "1080P", "720p": "720P", "x265": "HEVC", "h265": "HEVC",
  "hevc": "HEVC", "x264": "H264", "h264": "H264",
  "dolby vision": "DOV", "dovi": "DOV", "dv": "DOV",
  "hdr10+": "HDR", "hdr10": "HDR", "hdr": "HDR",
  "dolby atmos": "ATM", "atmos": "ATM", "truehd": "THD",
  "dts-hd": "DTS", "dts": "DTS", "eac3": "DDP", "ddp": "DDP",
  "flac": "FLAC", "remux": "HQR", "bluray": "HQR", "高码率": "HQR"
};

// ===================== 辅助函数：中文数字转换 =====================
function parseChineseNumber(chinese) {
  if (!chinese) return null;
  const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  if (map[chinese] !== undefined) return map[chinese];

  if (chinese.startsWith('十') && chinese.length === 2) {
    return 10 + (map[chinese[1]] || 0);
  }

  const parts = chinese.split('十');
  if (parts.length === 2) {
    const tens = parts[0] ? map[parts[0]] : 1;
    const unit = parts[1] ? map[parts[1]] : 0;
    return (tens === 1 ? 10 : tens * 10) + unit;
  }
  return null;
}

function numberToChinese(num) {
  if (num < 1 || num > 99) return num.toString();
  const units = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (num <= 10) return units[num] || num.toString();
  if (num < 20) {
    const unit = num % 10;
    return '十' + (unit > 0 ? units[unit] : '');
  }
  const tens = Math.floor(num / 10);
  const unit = num % 10;
  return units[tens] + '十' + (unit > 0 ? units[unit] : '');
}

// ===================== 增强的 parseNote =====================
function parseNote(note, tmdbData, searchWord, mediaType = 'unknown') {
  const result = {
    title: searchWord,
    year: tmdbData?.year || '0000',
    season: null,
    episode: '',
    totalEpisodes: null,
    resolution: '1080P',
    hdr: 'SDR',
    videoCodec: 'H264',
    audioCodec: 'AAC'
  };
  if (!note) return result;

  let normalizedNote = note;
  for (const [key, value] of Object.entries(REPLACE_RULES)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedKey, 'gi');
    normalizedNote = normalizedNote.replace(regex, value);
  }
  normalizedNote = normalizedNote.replace(/\s+/g, ' ').trim();

  const cleanTitle = extractCleanTitle(note, searchWord);
  if (cleanTitle) result.title = cleanTitle;

  const yearMatch = note.match(/(19|20)\d{2}/);
  if (yearMatch) result.year = yearMatch[0];
  else if (tmdbData?.year) result.year = tmdbData.year;

  if (mediaType === 'tv') {
    let cleanName = normalizedNote
      .replace(/\[\d+(?:\.\d+)?\s*[GMK]B?\]/gi, '')
      .replace(/\(\d+(?:\.\d+)?\s*[GMK]B?\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const seasonEpisodePatterns = [
      { regex: /[Ss](\d{1,2})[Ee](\d{1,2})/, handler: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
      { regex: /第\s*(\d+|[零一二三四五六七八九十]+)\s*季\s*第\s*(\d+|[零一二三四五六七八九十]+)\s*集/, handler: (m) => ({ season: parseChineseNumber(m[1]) || parseInt(m[1]), episode: parseChineseNumber(m[2]) || parseInt(m[2]) }) },
    ];

    let found = false;
    for (const { regex, handler } of seasonEpisodePatterns) {
      const match = cleanName.match(regex);
      if (match) {
        const { season, episode } = handler(match);
        if (season && episode) {
          result.season = season;
          result.episode = `S${season.toString().padStart(2, '0')}-E${episode.toString().padStart(2, '0')}`;
          found = true;
          break;
        }
      }
    }

    if (!found) {
      const seasonMatch = cleanName.match(/[Ss](\d{1,2})/);
      if (seasonMatch) result.season = parseInt(seasonMatch[1]);
      else {
        const seasonChineseMatch = cleanName.match(/第\s*(\d+|[零一二三四五六七八九十]+)\s*季/);
        if (seasonChineseMatch) result.season = parseChineseNumber(seasonChineseMatch[1]) || parseInt(seasonChineseMatch[1]);
      }

      let epNum = null;
      const episodePatterns = [
        /[Ee](\d{1,2})/, /EP[_. ]?(\d{1,2})/i, /第(\d{1,2})[集期]/, /第\s*(\d+|[零一二三四五六七八九十]+)\s*集/
      ];
      for (const pattern of episodePatterns) {
        const match = cleanName.match(pattern);
        if (match) {
          epNum = parseInt(match[1]) || parseChineseNumber(match[1]);
          if (epNum) break;
        }
      }
      if (!epNum) {
        const dashMatch = cleanName.match(/[-_.](\d{1,2})(?!\d)(?!\s*[GMK]B?\b)/i);
        if (dashMatch) epNum = parseInt(dashMatch[1]);
      }
      if (!epNum) {
        const standaloneMatch = cleanName.match(/(?:^|[^\d])(\d{1,2})(?!\d)/);
        if (standaloneMatch) epNum = parseInt(standaloneMatch[1]);
      }
      if (epNum) {
        const season = result.season || 1;
        result.episode = `S${season.toString().padStart(2, '0')}-E${epNum.toString().padStart(2, '0')}`;
      }

      const totalEpMatch = cleanName.match(/全\s*(\d{1,3})\s*集/);
      if (totalEpMatch) result.totalEpisodes = parseInt(totalEpMatch[1]);
    }
  }

  if (normalizedNote.includes('2160P') || normalizedNote.includes('4K')) result.resolution = '2160P';
  else if (normalizedNote.includes('1080P')) result.resolution = '1080P';
  else if (normalizedNote.includes('720P')) result.resolution = '720P';

  if (normalizedNote.includes('DOV') || normalizedNote.includes('杜比视界')) result.hdr = 'DOV';
  else if (normalizedNote.includes('HDR')) result.hdr = 'HDR';
  else if (normalizedNote.includes('HQR') || normalizedNote.includes('高码率')) result.hdr = 'HQR';
  if (normalizedNote.includes('HEVC')) result.videoCodec = 'HEVC';
  const audioMap = ['FLAC', 'ATM', 'THD', 'DTS', 'DDP', 'AAC'];
  for (const codec of audioMap) {
    if (normalizedNote.includes(codec)) { result.audioCodec = codec; break; }
  }
  return result;
}

function extractCleanTitle(note, searchWord) {
  if (!note) return '';
  const bookQuotesMatch = note.match(/《([^》]+)》/);
  if (bookQuotesMatch) return bookQuotesMatch[1].trim();
  const chineseMatch = note.match(/[\u4e00-\u9fa5]+/);
  if (chineseMatch) return chineseMatch[0];
  return searchWord || note.substring(0, 20);
}

function getResolutionValue(res) {
  switch (res) {
    case '2160P': return 2160;
    case '1080P': return 1080;
    case '720P': return 720;
    default: return 0;
  }
}

// ===================== 资源预处理与排序 =====================
const PREFERRED_SOURCES = []; // 可根据需要配置优先级

function preprocessAndSortResources(resources, searchWord, targetYear = '', mediaType = 'unknown') {
  const processed = [];
  const searchLower = searchWord.toLowerCase();

  for (const item of resources) {
    if (!item.name) continue;
    const name = item.name;
    const nameLower = name.toLowerCase();
    let relevance = 0;

    // 降分项
    if (nameLower.includes('短剧')) relevance -= 200;
    if (/千金|甜婚|炽爱|引诱|复仇|明月|白月光|母爱/.test(nameLower)) relevance -= 30;

    // 加分项
    if (targetYear && name.includes(targetYear.toString())) relevance += 100;
    if (/全集|全\s*\d+\s*集|\d+\s*集|完结/.test(nameLower)) relevance += 40;
    if (/电视剧|连续剧|剧集/.test(nameLower)) relevance += 50;
    if (/4k|2160p|hdr|高码率/.test(nameLower)) relevance += 30;

    const pureName = nameLower.replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
    if (pureName === searchLower || pureName === searchLower + targetYear) relevance += 80;

    const parsed = parseNote(name, null, searchWord, mediaType);
    const date = dayjs(item.datetime);
    const containsSearch = nameLower.includes(searchLower);

    processed.push({
      ...item,
      _relevance: relevance,
      _date: date.isValid() ? date : dayjs(0),
      _containsSearch: containsSearch,
      _parsed: parsed,
      _resValue: getResolutionValue(parsed.resolution)
    });
  }

  processed.sort((a, b) => {
    if (a._relevance !== b._relevance) return b._relevance - a._relevance;
    if (a._containsSearch && !b._containsSearch) return -1;
    if (!a._containsSearch && b._containsSearch) return 1;
    return b._date.unix() - a._date.unix();
  });

  if (SORT_DEBUG) {
    processed.slice(0, 5).forEach((item, idx) => {
      log.info(`[排序调试] #${idx + 1} 网盘:${item.source || '?'} 得分:${item._relevance} | 名称:${item.name?.substring(0, 80)}`);
    });
  }

  return processed.map(({ _relevance, _date, _containsSearch, _parsed, _resValue, ...rest }) => rest);
}

// ===================== 格式化资源名称 =====================
function formatResourceName(item, tmdbData, driveKey, searchWord, mediaType = 'unknown') {
  const note = item.name || '';
  const source = item.source || '';
  const datetime = item.datetime || '';

  let dateStr = '00.00';
  if (datetime && !datetime.startsWith('0001-01-01')) {
    const d = dayjs(datetime);
    if (d.isValid()) dateStr = d.format('MM.DD');
  }
  const dateDisplay = dateStr === '00.00' ? '无更新' : dateStr;

  const parsed = parseNote(note, tmdbData, searchWord, mediaType);

  const techTags = [];
  if (parsed.resolution !== '1080P') techTags.push(parsed.resolution);
  if (parsed.hdr !== 'SDR') techTags.push(parsed.hdr);
  if (parsed.videoCodec !== 'H264') techTags.push(parsed.videoCodec);
  if (parsed.audioCodec !== 'AAC') techTags.push(parsed.audioCodec);
  const techPart = techTags.length > 0 ? `【${techTags.join('｜')}】` : '';

  const yearPart = parsed.year !== '0000' ? `(${parsed.year})` : '';

  let episodePart = '';
  if (mediaType === 'tv') {
    if (parsed.episode && parsed.episode !== 'S00-E00') {
      episodePart = ` ${parsed.episode}`;
    } else if (parsed.totalEpisodes) {
      episodePart = ` [全${parsed.totalEpisodes}集]`;
    }
  }

  const sourcePart = source ? ` [${source}]` : '';

  const finalName = `${parsed.title}${yearPart}${techPart}${episodePart} ${dateDisplay}${sourcePart}`;
  return finalName.trim();
}

// ===================== 播放串标准化 =====================
function normalizeEpisodePlayUrl(playUrl, vodTitle) {
  if (!playUrl) return playUrl;

  const episodes = playUrl.split('#');
  const normalizedEpisodes = episodes.map(ep => {
    const sepIndex = ep.indexOf('$');
    if (sepIndex === -1) return ep;

    const name = ep.substring(0, sepIndex);
    const link = ep.substring(sepIndex + 1);

    let fileSize = '';
    const sizeMatch = name.match(/\[(\d+(?:\.\d+)?[GMK]B?)\]/i);
    if (sizeMatch) fileSize = sizeMatch[1];

    let nameForEp = name
      .replace(/\[\d+(?:\.\d+)?\s*[GMK]B?\]/gi, '')
      .replace(/\(\d+(?:\.\d+)?\s*[GMK]B?\)/gi, '')
      .trim();

    let episodeTag = '';
    const sxeMatch = nameForEp.match(/[Ss](\d+)[Ee](\d+)/i);
    if (sxeMatch) {
      const season = parseInt(sxeMatch[1]).toString();
      const episode = sxeMatch[2].padStart(2, '0');
      episodeTag = `S${season}E${episode}`;
    } else {
      const patterns = [
        /[Ee](\d{1,2})/i, /EP[_. ]?(\d{1,2})/i, /第(\d{1,2})[集期]/i, /第\s*(\d+|[零一二三四五六七八九十]+)\s*集/i
      ];
      for (const pattern of patterns) {
        const match = nameForEp.match(pattern);
        if (match) {
          let num = parseInt(match[1]);
          if (isNaN(num)) num = parseChineseNumber(match[1]);
          if (num && num >= 1 && num <= 999) {
            episodeTag = `E${num.toString().padStart(2, '0')}`;
            break;
          }
        }
      }
      if (!episodeTag) {
        const dashMatch = nameForEp.match(/[-_.](\d{1,2})(?!\d)(?!\s*[GMK]B?\b)/i);
        if (dashMatch) episodeTag = `E${dashMatch[1].padStart(2, '0')}`;
      }
    }

    let extraDesc = nameForEp;
    extraDesc = extraDesc.replace(/[Ss]\d+[Ee]\d+/gi, '').trim();
    extraDesc = extraDesc.replace(/EP\d+/gi, '').trim();
    extraDesc = extraDesc.replace(/[Ee]\d+/g, '').trim();
    extraDesc = extraDesc.replace(/第\d+[集期]/g, '').trim();
    extraDesc = extraDesc.replace(/[-_.]\d{1,2}\s*$/, '').trim();
    extraDesc = extraDesc.replace(/\s+/g, ' ').trim();
    if (episodeTag && extraDesc) {
      const tagNumber = episodeTag.replace(/[^0-9]/g, '');
      if (extraDesc === tagNumber || extraDesc === parseInt(tagNumber).toString()) extraDesc = '';
    }

    const displayName = `${fileSize ? `[${fileSize}]` : ''} ${episodeTag || '播放'}${extraDesc ? `.${extraDesc}` : ''}`.trim();
    return `${displayName}$${link}`;
  });

  return normalizedEpisodes.join('#');
}

// ===================== 集标题增强（需要TMDB季信息）=====================
function buildSeasonEpisodeMap(seasons) {
  const map = new Map();
  for (const season of seasons) {
    const epMap = new Map();
    for (const ep of season.episodes) {
      epMap.set(ep.episode_number, ep.name);
    }
    map.set(season.season_number, epMap);
  }
  return map;
}

function enhancePlayUrlWithTitles(playUrl, vodTitle, seasons, targetSeason = null) {
  if (!playUrl || !seasons || seasons.length === 0) return playUrl;

  const seasonMap = buildSeasonEpisodeMap(seasons);
  const episodes = playUrl.split('#');

  const enhancedEpisodes = episodes.map(ep => {
    const sepIndex = ep.indexOf('$');
    if (sepIndex === -1) return ep;

    const originalName = ep.substring(0, sepIndex);
    const link = ep.substring(sepIndex + 1);

    let fileSize = '';
    const sizeMatch = originalName.match(/\[(\d+(?:\.\d+)?[GMK]B?)\]/i);
    if (sizeMatch) fileSize = sizeMatch[1];

    let nameWithoutSize = originalName.replace(/\[\d+(?:\.\d+)?[GMK]B?\]/gi, '').trim();

    let seasonNum = null, episodeNum = null;
    const sxeMatch = nameWithoutSize.match(/[Ss](\d+)[Ee](\d+)/i);
    if (sxeMatch) {
      seasonNum = parseInt(sxeMatch[1]);
      episodeNum = parseInt(sxeMatch[2]);
    } else {
      const seasonMatch = nameWithoutSize.match(/[Ss](\d+)/i);
      if (seasonMatch) seasonNum = parseInt(seasonMatch[1]);
      const episodePatterns = [
        /[Ee](\d+)/i, /EP[_. ]?(\d+)/i, /第(\d+)[集期]/, /第\s*(\d+|[零一二三四五六七八九十]+)\s*集/i
      ];
      for (const pattern of episodePatterns) {
        const match = nameWithoutSize.match(pattern);
        if (match) {
          let num = parseInt(match[1]);
          if (isNaN(num)) num = parseChineseNumber(match[1]);
          if (num && num >= 1 && num <= 999) {
            episodeNum = num;
            break;
          }
        }
      }
      if (!episodeNum) {
        const dashMatch = nameWithoutSize.match(/[-_.](\d{1,2})(?!\d)(?!\s*[GMK]B?\b)/i);
        if (dashMatch) episodeNum = parseInt(dashMatch[1]);
      }
      if (!episodeNum) {
        const standaloneMatch = nameWithoutSize.match(/(?:^|\s)(\d{1,2})(?=\s|$|[.,;!?])/);
        if (standaloneMatch) episodeNum = parseInt(standaloneMatch[1]);
      }
    }

    if (!episodeNum) return ep;

    let finalSeason = seasonNum;
    if (!finalSeason) {
      if (targetSeason) finalSeason = targetSeason;
      else {
        for (const [sNum, epMap] of seasonMap.entries()) {
          if (epMap.has(episodeNum)) { finalSeason = sNum; break; }
        }
        if (!finalSeason) finalSeason = 1;
      }
    }

    let episodeTitle = '';
    if (seasonMap.has(finalSeason)) {
      episodeTitle = seasonMap.get(finalSeason).get(episodeNum) || '';
    }
    if (!episodeTitle) episodeTitle = vodTitle;

    const seasonStr = finalSeason.toString().padStart(2, '0');
    const episodeStr = episodeNum.toString().padStart(2, '0');
    const sizePart = fileSize ? `[${fileSize}]` : '';
    const displayName = `${sizePart}${episodeTitle}.S${seasonStr}E${episodeStr}`;
    return `${displayName}$${link}`;
  });

  return enhancedEpisodes.join('#');
}

// ===================== 小文件线路过滤 =====================
function isLineMostlySmallFiles(playUrl, thresholdMB = 200) {
  if (!playUrl) return false;
  const episodes = playUrl.split('#');
  let smallCount = 0, totalWithSize = 0;
  for (const ep of episodes) {
    const sizeMatch = ep.match(/\[(\d+(?:\.\d+)?)\s*([GMK]?)B?\]/i);
    if (sizeMatch) {
      const size = parseFloat(sizeMatch[1]);
      const unit = (sizeMatch[2] || 'M').toUpperCase();
      const mb = unit === 'G' ? size * 1024 : unit === 'M' ? size : size / 1024;
      totalWithSize++;
      if (mb < thresholdMB) smallCount++;
    }
  }
  if (totalWithSize === 0) return false;
  return (smallCount / totalWithSize) > 0.5;
}

// ===================== TMDB 相关 =====================
const fetchTMDBImage = async (title) => {
  if (!USE_TMDB_IMAGE || !TMDB_API_KEY || !title) return null;
  const cacheKey = `tmdb_img_${title}`;
  const cached = tmdbImageCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL.image) return cached.url;
  try {
    let url = `${DATA_SOURCES.tmdbApi}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=zh-CN&page=1`;
    let res = await tmdbHttp.get(url);
    let results = res.data?.results;
    if (!results || results.length === 0) {
      url = `${DATA_SOURCES.tmdbApi}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=zh-CN&page=1`;
      res = await tmdbHttp.get(url);
      results = res.data?.results;
    }
    if (results && results.length > 0 && results[0].poster_path) {
      const imageUrl = `${DATA_SOURCES.tmdbImage}${results[0].poster_path}`;
      tmdbImageCache.set(cacheKey, { url: imageUrl, time: Date.now() });
      return imageUrl;
    }
  } catch (e) {
    log.info(`[TMDB] 搜索封面失败: ${title}, ${e.message}`);
  }
  return null;
};

const fetchTMDBDetail = async (title, timer) => {
  if (!TMDB_API_KEY || !title) return null;
  const cacheKey = `tmdb_detail_${title}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL.tmdb) {
    if (timer) timer.cacheHit('TMDB详情', title);
    return cached.data;
  }
  if (timer) timer.cacheMiss('TMDB详情', title);

  try {
    let url = `${DATA_SOURCES.tmdbApi}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=zh-CN&page=1`;
    let res = await tmdbHttp.get(url);
    let results = res.data?.results;
    let mediaType = 'tv';
    let tvId = null;
    if (results && results.length > 0) tvId = results[0].id;
    else {
      url = `${DATA_SOURCES.tmdbApi}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=zh-CN&page=1`;
      res = await tmdbHttp.get(url);
      results = res.data?.results;
      mediaType = 'movie';
      if (results && results.length > 0) tvId = results[0].id;
    }
    if (!tvId) return null;

    const detailUrl = `${DATA_SOURCES.tmdbApi}/${mediaType}/${tvId}?api_key=${TMDB_API_KEY}&language=zh-CN`;
    const detailRes = await tmdbHttp.get(detailUrl);
    const detail = detailRes.data;

    const data = {
      id: detail.id,
      title: detail.name || detail.title || title,
      pic: detail.poster_path ? `${DATA_SOURCES.tmdbImage}${detail.poster_path}` : "",
      year: (detail.first_air_date || detail.release_date || "").substring(0, 4),
      intro: detail.overview || "",
      genres: (detail.genres || []).map(g => g.name).join('/'),
      rating: detail.vote_average ? `${detail.vote_average.toFixed(1)}分` : "",
      media_type: mediaType
    };
    if (mediaType === 'tv') {
      data.seasons = detail.seasons ? detail.seasons.filter(s => s.season_number > 0).map(s => ({
        season_number: s.season_number,
        episode_count: s.episode_count,
        name: s.name
      })) : [];
    }
    tmdbCache.set(cacheKey, { data, time: Date.now() });
    return data;
  } catch (e) {
    log.info(`[TMDB] 获取详情失败: ${title}, ${e.message}`);
    return null;
  }
};

const fetchTMDBSeasons = async (tmdbId, seasonNumber = null, language = 'zh-CN') => {
  if (!tmdbId) return null;
  const cacheKey = `tmdb_seasons_${tmdbId}_${seasonNumber || 'all'}_${language}`;
  const cached = tmdbSeasonsCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL.seasons) {
    log.info(`[TMDB季] 缓存命中: ${cacheKey}`);
    return cached.data;
  }
  log.info(`[TMDB季] 获取: ${cacheKey}`);

  try {
    if (seasonNumber !== null && seasonNumber > 0) {
      const seasonUrl = `${DATA_SOURCES.tmdbApi}/tv/${tmdbId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=${language}`;
      const seasonRes = await tmdbHttp.get(seasonUrl);
      const season = seasonRes.data;
      const seasonDetail = {
        season_number: season.season_number,
        episode_count: season.episodes.length,
        episodes: season.episodes.map(ep => ({
          episode_number: ep.episode_number,
          name: ep.name,
          overview: ep.overview,
          still_path: ep.still_path ? `${DATA_SOURCES.tmdbImage}${ep.still_path}` : null,
          air_date: ep.air_date
        }))
      };
      tmdbSeasonsCache.set(cacheKey, { data: [seasonDetail], time: Date.now() });
      return [seasonDetail];
    } else {
      const tvUrl = `${DATA_SOURCES.tmdbApi}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=${language}`;
      const tvRes = await tmdbHttp.get(tvUrl);
      const seasons = tvRes.data.seasons || [];
      const seasonPromises = seasons.map(async (season) => {
        if (season.season_number === 0) return null;
        const seasonUrl = `${DATA_SOURCES.tmdbApi}/tv/${tmdbId}/season/${season.season_number}?api_key=${TMDB_API_KEY}&language=${language}`;
        const seasonRes = await tmdbHttp.get(seasonUrl);
        return {
          season_number: season.season_number,
          episode_count: seasonRes.data.episodes.length,
          episodes: seasonRes.data.episodes.map(ep => ({
            episode_number: ep.episode_number,
            name: ep.name,
            overview: ep.overview,
            still_path: ep.still_path ? `${DATA_SOURCES.tmdbImage}${ep.still_path}` : null,
            air_date: ep.air_date
          }))
        };
      });
      const seasonDetails = (await Promise.all(seasonPromises)).filter(Boolean);
      tmdbSeasonsCache.set(cacheKey, { data: seasonDetails, time: Date.now() });
      return seasonDetails;
    }
  } catch (e) {
    log.info(`[TMDB季] 获取失败: ${e.message}`);
    return null;
  }
};

// ===================== 网盘驱动解析 =====================
const getDriveParseWithCache = async (url, driveKey, drives) => {
  const cacheKey = `${driveKey}_${url}`;
  const cached = driveParseCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL.drive) {
    log.info(`[驱动缓存] 命中: ${driveKey}`);
    return { data: cached.data, fromCache: true };
  }

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('驱动超时')), 10000)
  );

  try {
    const result = await Promise.race([
      getEpisodesFromDrive(url, driveKey, drives),
      timeoutPromise
    ]);

    driveParseCache.set(cacheKey, { data: result, time: Date.now() });
    return { data: result, fromCache: false };
  } catch (error) {
    log.info(`[驱动解析] 失败/超时: ${driveKey}, ${error.message}`);
    return { data: null, fromCache: false, error: error.message };
  }
};

const getEpisodesFromDrive = async (url, driveKey, drives) => {
  log.info(`[网盘驱动] 获取剧集: ${driveKey}, URL: ${url.substring(0, 50)}...`);

  const drive = drives.find(d => d.key === driveKey);
  if (!drive) {
    log.info(`[网盘驱动] 未找到驱动: ${driveKey}`);
    return null;
  }

  try {
    if (!drive.matchShare || !drive.matchShare(url)) {
      log.info(`[网盘驱动] 驱动不匹配: ${driveKey}`);
      return null;
    }

    const vod = await drive.getVod(url);
    if (!vod) {
      log.info(`[网盘驱动] 获取 VOD 失败: ${driveKey}`);
      return null;
    }

    let isValid = true;
    if (vod.vod_play_url) {
      const parts = vod.vod_play_url.split('#');
      if (parts.length === 1) {
        const [name] = parts[0].split('$');
        if (['播放', '全集', '点击播放', '立即播放'].includes(name)) {
          isValid = false;
        }
      }
    } else {
      isValid = false;
    }

    if (!isValid) {
      log.info(`[网盘驱动] 播放串无效: ${driveKey}`);
      return null;
    }

    log.info(`[网盘驱动] 获取成功: ${driveKey}, 线路:${vod.vod_play_from}, 集数:${vod.vod_play_url?.split('#').length || 0}`);

    return {
      playFrom: vod.vod_play_from || driveKey,
      playUrl: vod.vod_play_url,
      vodPic: vod.vod_pic || "",
      vodContent: vod.vod_content || "",
      vodActor: vod.vod_actor || "",
      vodDirector: vod.vod_director || ""
    };
  } catch (error) {
    log.info(`[网盘驱动] 错误: ${error.message}`);
    return null;
  }
};

// ===================== 热搜榜（剧盘搜分类） =====================
async function fetchHotRanking(channel, limit = 120) {
  const cacheKey = `hot_${channel}`;
  const cached = hotCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL.hot) {
    log.info(`[热搜榜] 缓存命中: ${channel}，共 ${cached.data.length} 条`);
    return cached.data;
  }

  log.info(`[热搜榜] 开始获取: ${channel}`);
  const startTime = Date.now();
  try {
    const url = `https://pan.dyuzi.com/api/frontend/ranking?channel=${encodeURIComponent(channel)}&limit=${limit}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    if (response.data.code === 0 && response.data.data?.list) {
      const list = response.data.data.list;
      const elapsed = Date.now() - startTime;
      log.info(`[热搜榜] 获取成功: ${channel}，共 ${list.length} 条，耗时 ${elapsed}ms`);
      hotCache.set(cacheKey, { data: list, time: Date.now() });
      return list;
    }
    log.warn(`[热搜榜] 返回数据异常: ${response.data.message}`);
    return [];
  } catch (e) {
    const elapsed = Date.now() - startTime;
    log.error(`[热搜榜] 请求失败: ${e.message}，耗时 ${elapsed}ms`);
    return [];
  }
}

// ===================== 多账号管理 =====================
let accounts = [];
let currentAccountIndex = 0;

function generateHash(username) {
  const salt = "pansou_gying_secret_2025";
  const data = username + salt;
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function initAccount(account) {
  const client = new GyingClient(account.baseUrl, account.username, account.password);
  try {
    await client.login();
    account.client = client;
    account.logged_in = true;
    account.hash = generateHash(account.username);
    log.info(`[账号] 初始化成功: ${account.hash} (${account.username})`);
    return true;
  } catch (e) {
    account.logged_in = false;
    log.error(`[账号] 初始化失败: ${account.username} - ${e.message}`);
    return false;
  }
}

async function initAccounts(accountsConfig) {
  if (!accountsConfig || !accountsConfig.length) {
    log.warn(`[账号] 未配置任何账号`);
    return;
  }

  const initPromises = accountsConfig.map(async (cfg) => {
    const account = { ...cfg, logged_in: false };
    try {
      const ok = await initAccount(account);
      if (ok) {
        accounts.push(account);
        log.info(`[账号] 已添加到账号池: ${account.username} (${account.hash})`);
      } else {
        log.error(`[账号] 初始化失败: ${account.username}`);
      }
    } catch (e) {
      log.error(`[账号] 初始化异常: ${account.username}, ${e.message}`);
    }
  });

  // 不阻塞，后台执行
  Promise.allSettled(initPromises).then(() => {
    log.info(`[账号] 初始化阶段结束，当前可用账号数: ${accounts.filter(a => a.logged_in).length} / ${accounts.length}`);
    log.info(`[账号] 账号池详情: ${accounts.map(a => `${a.username}(${a.logged_in ? '登录' : '未登录'})`).join(', ')}`);
  }).catch(e => log.error(`账号初始化完成处理失败: ${e.message}`));
}

function selectAccount() {
  log.info(`[负载均衡] 当前账号池大小: ${accounts.length}`);
  if (!accounts.length) {
    log.warn('[负载均衡] 账号列表为空');
    return null;
  }

  const startIdx = currentAccountIndex;
  log.info(`[负载均衡] 开始轮询，起始索引: ${startIdx}`);

  let selected = null;
  let selectedIdx = -1;
  for (let i = 0; i < accounts.length; i++) {
    const idx = (startIdx + i) % accounts.length;
    const account = accounts[idx];
    if (account.logged_in) {
      selected = account;
      selectedIdx = idx;
      break;
    }
  }

  if (selected) {
    currentAccountIndex = (selectedIdx + 1) % accounts.length;
    log.info(`[负载均衡] 选中账号: ${selected.hash} (索引 ${selectedIdx})，下次起始索引: ${currentAccountIndex}`);
    return selected;
  }

  log.warn(`[负载均衡] 无可用账号，尝试重新登录所有账号`);
  for (const account of accounts) {
    // 重新登录逻辑（可扩展）
    if (!account.logged_in && account.username && account.password) {
      const client = new GyingClient(account.baseUrl, account.username, account.password);
      client.login().then(() => {
        account.client = client;
        account.logged_in = true;
      }).catch(e => log.error(e));
    }
  }
  const fallback = accounts[0];
  log.warn(`[负载均衡] 无可用账号，返回第一个作为兜底: ${fallback?.hash || 'null'}`);
  return fallback || null;
}

async function healthCheckAccount(account) {
  if (!account.client) return;
  try {
    // 简单测试：访问首页
    await account.client.client.get(account.client.baseUrl + '/');
    account.logged_in = true;
    account.last_check = Date.now();
  } catch (e) {
    log.warn(`[账号] ${account.hash} 健康检查失败，尝试重新登录`);
    try {
      await account.client.login();
      account.logged_in = true;
    } catch (loginErr) {
      account.logged_in = false;
    }
  }
}

function startHealthCheck() {
  if (!accounts.length) return;
  setInterval(async () => {
    for (const account of accounts) {
      await healthCheckAccount(account);
    }
  }, ACCOUNT_HEALTH_CHECK_INTERVAL);
}

// ===================== 观影 API 相关 =====================

const typeMapping = {
  'baidu': 'baidu',
  'quark': 'quark',
  'xunlei': 'xunlei',
  'uc': 'uc',
  'aliyun': 'ali',
  'tianyi': 'a189',
  '115': 'a115',
  'a139': 'a139',
  'a123': 'a123',
  'pikpak': 'pikpak'
};

const callGyApi = async (account, wd, timer) => {
  if (!account || !account.client || !account.logged_in) return null;
  const cacheKey = `gy_api_${account.hash}_${wd}`;
  const cached = gyApiCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL.gyApi) {
    if (timer) timer.cacheHit('观影API', `${account.hash}:${wd}`);
    return cached.data;
  }
  if (timer) timer.cacheMiss('观影API', `${account.hash}:${wd}`);

  try {
    const results = await account.client.search(wd);
    if (!Array.isArray(results)) {
      log.error(`[观影API] 搜索结果不是数组: ${typeof results}, 账号:${account.hash}`);
      gyApiCache.set(cacheKey, { data: null, time: Date.now() });
      return null;
    }
    if (results.length === 0) {
      gyApiCache.set(cacheKey, { data: null, time: Date.now() });
      return null;
    }

    const firstResult = results[0];
    const title = firstResult.title;
    const grouped = {};

    for (const res of results) {
      for (const link of res.links) {
        const panKey = link.type;
        if (!grouped[panKey]) grouped[panKey] = [];
        grouped[panKey].push({
          url: link.url,
          password: link.password || '',
          type: panKey
        });
      }
    }

    const apiData = { title, grouped };
    gyApiCache.set(cacheKey, { data: apiData, time: Date.now() });
    log.info(`[观影API] 成功获取 ${Object.keys(grouped).length} 个网盘分组，总链接数 ${results.reduce((acc, r) => acc + r.links.length, 0)} (账号:${account.hash})`);
    return apiData;
  } catch (e) {
    log.error(`[观影API] 请求失败: ${e.message} (账号:${account.hash})`);
    return null;
  }
};

const getPanLinks = async (account, panKey, wd, timer) => {
  const apiData = await callGyApi(account, wd, timer);
  if (!apiData) return [];
  return apiData.grouped[panKey] || [];
};

// ===================== 资源列表函数（列表模式） =====================
function formatResourceNameSimple(link, panKey, searchWord) {
  let name = searchWord;
  if (link.password) {
    name += ` [密码:${link.password}]`;
  }
  return name;
}

const getPanResourceList = async (account, panKey, wd, page, timer) => {
  const count = 20;
  const pg = parseInt(page) || 1;
  const start = (pg - 1) * count;

  log.info(`[资源列表] ${panKey}, 关键词: ${wd}, 页码: ${pg}, 账号:${account.hash}`);

  const links = await getPanLinks(account, panKey, wd, timer);
  if (!links || links.length === 0) {
    log.warn(`[资源列表] 无结果: ${panKey}/${wd}`);
    return { list: [], page: pg, pagecount: 1, limit: count, total: 0 };
  }

  let poster = null;
  if (USE_TMDB_IMAGE && TMDB_API_KEY) {
    poster = await fetchTMDBImage(wd);
  }

  const total = links.length;
  const pageItems = links.slice(start, start + count);

  const list = pageItems.map((link, index) => {
    const encodedUrl = encodeURIComponent(link.url);
    const encodedWd = encodeURIComponent(wd);
    const linkId = `link://${account.hash}/${panKey}/${encodedUrl}?title=${encodedWd}`;

    const displayName = formatResourceNameSimple(link, panKey, wd);
    const remarks = link.password ? `🔒密码:${link.password}` : "无密码";

    return {
      vod_id: linkId,
      vod_name: displayName,
      vod_pic: poster || panPic[panKey] || "",
      vod_remarks: remarks,
      time: Date.now(),
      _pan_key: panKey,
      _link: link
    };
  });

  return {
    list,
    page: pg,
    pagecount: Math.ceil(total / count) || 1,
    limit: count,
    total
  };
};

const getLinkDetail = async (linkId, title, drives, timer) => {
  log.info(`[单链接详情] 解析: ${linkId}`);

  let accountHash, panKey, encodedUrl, searchTitle;

  if (linkId.includes('?title=')) {
    const [basePart, queryPart] = linkId.split('?');
    const match = basePart.match(/^link:\/\/([^/]+)\/([^/]+)\/(.+)$/);
    if (match) {
      [, accountHash, panKey, encodedUrl] = match;
      const params = new URLSearchParams(queryPart);
      searchTitle = params.get('title');
    }
  } else {
    const match = linkId.match(/^link:\/\/([^/]+)\/([^/]+)\/(.+)$/);
    if (match) [, accountHash, panKey, encodedUrl] = match;
  }

  if (!accountHash || !panKey || !encodedUrl) {
    log.error(`[单链接详情] ID格式错误: ${linkId}`);
    return {
      vod_id: linkId,
      vod_name: title || "未知资源",
      vod_play_from: "错误",
      vod_play_url: `解析失败$https://www.douban.com`
    };
  }

  const linkUrl = decodeURIComponent(encodedUrl);
  searchTitle = searchTitle || title || "网盘资源";

  log.info(`[单链接详情] 账号:${accountHash}, 网盘: ${panKey}, 链接: ${linkUrl.substring(0, 50)}..., 标题: ${searchTitle}`);

  const account = accounts.find(a => a.hash === accountHash);
  if (!account) {
    log.error(`[单链接详情] 未找到账号: ${accountHash}`);
    return {
      vod_id: linkId,
      vod_name: searchTitle,
      vod_remarks: "账号不存在",
      vod_play_from: "温馨提示",
      vod_play_url: "该账号已失效$https://www.douban.com"
    };
  }

  let tmdbInfo = null;
  let seasonDetails = null;
  if (USE_TMDB_IMAGE && TMDB_API_KEY) {
    tmdbInfo = await fetchTMDBDetail(searchTitle, timer);
    if (tmdbInfo && tmdbInfo.media_type === 'tv' && tmdbInfo.id) {
      seasonDetails = await fetchTMDBSeasons(tmdbInfo.id, null, 'zh-CN');
    }
  }

  const driveResult = await getDriveParseWithCache(linkUrl, panKey, drives);

  if (!driveResult.data) {
    log.warn(`[单链接详情] 驱动解析失败: ${panKey}, ${linkUrl}`);
    return {
      vod_id: linkId,
      vod_name: searchTitle,
      vod_pic: (USE_TMDB_IMAGE && tmdbInfo?.pic) ? tmdbInfo.pic : (panPic[panKey] || ""),
      vod_remarks: "解析失败",
      vod_content: tmdbInfo?.intro || `资源链接: ${linkUrl}\n可能已失效或需要密码`,
      vod_play_from: "温馨提示",
      vod_play_url: "该链接无法解析或已失效$https://www.douban.com"
    };
  }

  let enhancedUrl = driveResult.data.playUrl;
  if (seasonDetails && seasonDetails.length > 0) {
    enhancedUrl = enhancePlayUrlWithTitles(driveResult.data.playUrl, tmdbInfo?.title || searchTitle, seasonDetails);
  } else {
    enhancedUrl = normalizeEpisodePlayUrl(driveResult.data.playUrl, searchTitle);
  }

  return {
    vod_id: linkId,
    vod_name: tmdbInfo?.title || searchTitle,
    vod_pic: (USE_TMDB_IMAGE && tmdbInfo?.pic) ? tmdbInfo.pic : (driveResult.data.vodPic || panPic[panKey] || ""),
    vod_remarks: "解析成功",
    vod_content: tmdbInfo?.intro || driveResult.data.vodContent || `资源: ${searchTitle}`,
    vod_actor: tmdbInfo?.actors || driveResult.data.vodActor || "",
    vod_director: tmdbInfo?.directors || driveResult.data.vodDirector || "",
    vod_year: tmdbInfo?.year || "",
    vod_play_from: driveResult.data.playFrom || panKey,
    vod_play_url: enhancedUrl
  };
};

// 搜索所有网盘（使用指定账号）
const searchAllPans = async (account, wd, timer) => {
  const start = Date.now();
  log.info(`[搜索] 开始调用观影 API: ${wd}, 账号:${account.hash}`);

  const apiData = await callGyApi(account, wd, timer);
  if (!apiData) {
    log.warn(`[搜索] 观影 API 无数据，返回空结果`);
    return {};
  }

  const groupedResults = {};
  let totalCount = 0;

  for (const panKey of PAN_ORDER) {
    const links = apiData.grouped[panKey] || [];
    if (links.length === 0) continue;

    const items = links.map((link, idx) => ({
      vod_id: `gy_${panKey}_${idx}_${Date.now()}`,
      vod_name: `${panNames[panKey]}链接${idx + 1}`,
      vod_pic: panPic[panKey] || "",
      vod_remarks: link.password ? `🛡️密码: ${link.password}` : "无密码",
      _link_url: link.url,
      _link_password: link.password,
      _pan_key: panKey,
      _is_gy: true,
      _account_hash: account.hash
    }));

    groupedResults[panKey] = items;
    totalCount += items.length;
  }

  log.info(`[搜索] 完成: 共 ${totalCount} 个资源，耗时 ${Date.now() - start}ms`);
  return groupedResults;
};

// ===================== 核心功能 =====================

// 搜索
const _search = async (wd, page, drives) => {
  const timer = createTimer();
  log.info(`[搜索] 关键词: ${wd}, 页码: ${page}, 列表模式: ${TVBOX_LIST_MODE}`);

  const result = { list: [], page: parseInt(page) || 1, pagecount: 1, total: 0 };

  const account = selectAccount();
  if (!account) {
    log.error(`[搜索] 没有可用账号`);
    return result;
  }
  log.info(`[搜索] 使用账号: ${account.hash}`);

  try {
    const groupedResults = await searchAllPans(account, wd, timer);

    let tmdbPoster = null;
    if (USE_TMDB_IMAGE && TMDB_API_KEY) {
      tmdbPoster = await fetchTMDBImage(wd);
      timer.step('TMDB图片获取', tmdbPoster ? '成功' : '失败/无结果');
    }

    for (const panKey of PAN_ORDER) {
      const items = groupedResults[panKey];
      if (!items || items.length === 0) continue;

      const displayName = USE_TMDB_IMAGE ? `${panNames[panKey]}【${wd}】` : panNames[panKey];

      const listItem = {
        vod_id: `drive_${account.hash}_${panKey}_${encodeURIComponent(wd)}`,
        vod_name: displayName,
        vod_pic: (USE_TMDB_IMAGE && tmdbPoster) ? tmdbPoster : (panPic[panKey] || ""),
        vod_remarks: `${items.length}个资源`,
        time: Date.now(),
        _pan_key: panKey,
        _links: items.map(item => ({ url: item._link_url, password: item._link_password })),
        _account_hash: account.hash
      };

      if (TVBOX_LIST_MODE) listItem.vod_tag = "folder";

      result.list.push(listItem);
    }

    result.list.sort((a, b) => b.time - a.time);
    result.total = result.list.length;
    result.pagecount = Math.ceil(result.total / 20) || 1;

    timer.summary('搜索', `返回${result.list.length}个网盘分组, 列表模式:${TVBOX_LIST_MODE}`);
  } catch (error) {
    log.error(`[搜索] 失败: ${error.message}`);
  }

  return result;
};

// 详情
const _detail = async (id, title, drives) => {
  const timer = createTimer();
  log.info(`[详情] ID: ${id}, 标题: ${title || '未知'}`);

  if (id.startsWith('link://')) {
    return await getLinkDetail(id, title, drives, timer);
  }

  if (id.startsWith('drive_')) {
    const parts = id.split('_');
    if (parts.length >= 4) {
      const accountHash = parts[1];
      const panKey = parts[2];
      const wd = decodeURIComponent(parts.slice(3).join('_'));

      log.info(`[详情] 网盘分组: ${panKey}, 关键词: ${wd}, 账号: ${accountHash}`);

      const account = accounts.find(a => a.hash === accountHash);
      if (!account) {
        log.error(`[详情] 未找到账号: ${accountHash}`);
        return {
          vod_id: id,
          vod_name: wd,
          vod_pic: panPic[panKey] || "",
          vod_remarks: "账号不存在",
          vod_content: "",
          vod_play_from: "",
          vod_play_url: ""
        };
      }

      let links = await getPanLinks(account, panKey, wd, timer);

      if (!links || links.length === 0) {
        log.warn(`[详情] 未找到任何资源: ${panKey}/${wd}`);
        return {
          vod_id: id,
          vod_name: wd,
          vod_pic: panPic[panKey] || "",
          vod_remarks: "无有效资源",
          vod_content: "",
          vod_play_from: "",
          vod_play_url: ""
        };
      }

      // 链接有效性检查
      const allUrls = links.map(l => l.url);
      const validSet = await checkLinksValidity(allUrls);
      links = links.filter(l => validSet.has(l.url));
      if (links.length === 0) {
        log.warn(`[详情] 所有链接均失效: ${panKey}/${wd}`);
        return {
          vod_id: id,
          vod_name: wd,
          vod_pic: panPic[panKey] || "",
          vod_remarks: "无有效资源",
          vod_content: "",
          vod_play_from: "",
          vod_play_url: ""
        };
      }

      // 获取TMDB信息并判断媒体类型
      let tmdbInfo = null;
      let seasonDetails = null;
      let mediaType = 'unknown';
      if (USE_TMDB_IMAGE && TMDB_API_KEY) {
        tmdbInfo = await fetchTMDBDetail(wd, timer);
        if (tmdbInfo) mediaType = tmdbInfo.media_type;
        if (tmdbInfo && tmdbInfo.media_type === 'tv' && tmdbInfo.id) {
          log.info(`[详情] 获取 TMDB 季详情: ${tmdbInfo.id}`);
          seasonDetails = await fetchTMDBSeasons(tmdbInfo.id, null, 'zh-CN');
          if (seasonDetails) log.info(`[详情] 获取到 ${seasonDetails.length} 季详情`);
        }
      }

      // 资源预处理与排序
      const resources = links.map(link => ({
        name: `${wd} ${link.password ? `密码:${link.password}` : ''}`,
        url: link.url,
        datetime: new Date().toISOString(),
        source: 'gying'
      }));
      const sortedResources = preprocessAndSortResources(resources, wd, tmdbInfo?.year || '', mediaType);
      const limitedLinks = sortedResources.slice(0, MAX_RESOURCES_TO_PARSE);

      log.info(`[详情] ${panKey} 将解析 ${limitedLinks.length} 个资源`);

      // 流式并发解析
      const controller = new StreamingConcurrencyController(CONCURRENCY_LIMIT);
      const playFromList = [];
      const playUrlList = [];
      const seenPans = new Map();
      const parseTasks = limitedLinks.map((item, idx) => ({
        task: async () => {
          if (playFromList.length >= EARLY_RETURN_THRESHOLD) return { cancelled: true };
          const driveResult = await getDriveParseWithCache(item.url, panKey, drives);
          if (!driveResult.data) return { success: false };
          return { success: true, data: driveResult.data, item, idx };
        },
        priority: idx
      }));

      for (const { task, priority } of parseTasks) {
        const result = await controller.add(task, priority);
        if (result.cancelled) continue;
        if (!result.success) continue;

        const { data, item } = result;
        const currentCount = seenPans.get(panKey) || 0;
        if (currentCount >= MAX_LINES_PER_PAN) continue;
        if (isLineMostlySmallFiles(data.playUrl, SMALL_FILE_THRESHOLD_MB)) {
          log.info(`[二次过滤] 屏蔽小文件线路: ${panKey}`);
          continue;
        }

        const lineName = currentCount === 0 ? panKey : `${panKey}#${currentCount + 1}`;
        playFromList.push(lineName);

        let enhancedUrl = data.playUrl;
        if (seasonDetails && seasonDetails.length > 0) {
          enhancedUrl = enhancePlayUrlWithTitles(data.playUrl, tmdbInfo?.title || wd, seasonDetails);
        } else {
          enhancedUrl = normalizeEpisodePlayUrl(data.playUrl, wd);
        }
        playUrlList.push(enhancedUrl);
        seenPans.set(panKey, currentCount + 1);
        log.info(`[详情] 添加线路: ${lineName}, 集数: ${enhancedUrl.split('#').length}`);
      }

      if (playFromList.length === 0) {
        log.warn(`[详情] 无有效播放线路: ${panKey}/${wd}`);
        return {
          vod_id: id,
          vod_name: wd,
          vod_pic: (USE_TMDB_IMAGE && tmdbInfo?.pic) ? tmdbInfo.pic : (panPic[panKey] || ""),
          vod_remarks: "无有效播放线路",
          vod_content: tmdbInfo?.intro || `搜索: ${wd}\n未找到有效播放资源`,
          vod_play_from: "温馨提示",
          vod_play_url: "未找到有效播放资源$https://www.douban.com"
        };
      }

      const finalResult = {
        vod_id: id,
        vod_name: tmdbInfo?.title || wd,
        vod_pic: (USE_TMDB_IMAGE && tmdbInfo?.pic) ? tmdbInfo.pic : (panPic[panKey] || ""),
        vod_remarks: `${playFromList.length}个线路`,
        vod_content: tmdbInfo?.intro || `搜索: ${wd}`,
        vod_actor: tmdbInfo?.actors || "",
        vod_director: tmdbInfo?.directors || "",
        vod_year: tmdbInfo?.year || "",
        vod_play_from: playFromList.join('$$$'),
        vod_play_url: playUrlList.join('$$$')
      };
      log.info(`[详情] 最终返回 ${playFromList.length} 条线路: ${playFromList.join(', ')}`);
      return finalResult;
    }
  }

  // 处理热搜榜入口
  if (id.startsWith('hot_')) {
    const parts = id.split('_');
    if (parts.length >= 3) {
      const channel = parts[1];
      let titleEncoded = parts.slice(2).join('_');
      let year = '';
      const lastPart = parts[parts.length - 1];
      if (/^\d{4}$/.test(lastPart) && parts.length > 3) {
        year = lastPart;
        titleEncoded = parts.slice(2, -1).join('_');
      }
      const searchTitle = decodeURIComponent(titleEncoded);
      log.info(`[详情] 热搜榜入口: 频道=${channel}, 标题="${searchTitle}", 年份=${year}`);
      const account = selectAccount();
      if (!account) {
        log.error(`[详情] 无可用账号，无法获取热搜榜详情`);
        return {
          vod_id: id,
          vod_name: searchTitle,
          vod_pic: "",
          vod_remarks: "无可用账号",
          vod_content: "所有观影 API 账号均不可用",
          vod_play_from: "温馨提示",
          vod_play_url: "账号失效$https://www.douban.com"
        };
      }
      return await _getDetailByKeyword(searchTitle, drives, account);
    }
  }

  return {
    vod_id: id,
    vod_name: title || "未知",
    vod_pic: "",
    vod_remarks: "",
    vod_content: "",
    vod_play_from: "",
    vod_play_url: ""
  };
};

// 根据关键词获取详情（用于热搜榜）
const _getDetailByKeyword = async (keyword, drives, account) => {
  log.info(`[详情] 根据关键词获取: ${keyword}, 账号: ${account.hash}`);

  const groupedResults = await searchAllPans(account, keyword, createTimer());
  if (!groupedResults || Object.keys(groupedResults).length === 0) {
    log.warn(`[详情] 未找到任何资源: ${keyword}`);
    return {
      vod_id: `hot_${keyword}`,
      vod_name: keyword,
      vod_play_from: "提示",
      vod_play_url: "未找到相关资源$https://www.douban.com"
    };
  }

  // 收集所有网盘的资源
  let allResources = [];
  for (const panKey of PAN_ORDER) {
    const items = groupedResults[panKey];
    if (items && items.length > 0) {
      allResources.push(...items.map(item => ({
        ...item,
        driveKey: panKey
      })));
    }
  }

  // 链接有效性检查
  const allUrls = allResources.map(r => r._link_url);
  const validSet = await checkLinksValidity(allUrls);
  allResources = allResources.filter(r => validSet.has(r._link_url));
  if (allResources.length === 0) {
    log.warn(`[详情] 无有效资源: ${keyword}`);
    return {
      vod_id: `hot_${keyword}`,
      vod_name: keyword,
      vod_play_from: "提示",
      vod_play_url: "该网盘暂无有效资源$https://www.douban.com"
    };
  }

  // 获取TMDB信息
  let tmdbInfo = null;
  let seasonDetails = null;
  let mediaType = 'unknown';
  if (USE_TMDB_IMAGE && TMDB_API_KEY) {
    tmdbInfo = await fetchTMDBDetail(keyword);
    if (tmdbInfo) mediaType = tmdbInfo.media_type;
    if (tmdbInfo && tmdbInfo.media_type === 'tv' && tmdbInfo.id) {
      seasonDetails = await fetchTMDBSeasons(tmdbInfo.id, null, 'zh-CN');
    }
  }

  // 限制每个网盘最多解析 MAX_LINES_PER_PAN 个资源
  const limitedByPan = {};
  for (const item of allResources) {
    if (!limitedByPan[item.driveKey]) limitedByPan[item.driveKey] = [];
    if (limitedByPan[item.driveKey].length < MAX_LINES_PER_PAN) {
      limitedByPan[item.driveKey].push(item);
    }
  }
  const itemsToParse = Object.values(limitedByPan).flat();

  log.info(`[详情] 将解析 ${itemsToParse.length} 个资源`);

  // 流式并发解析
  const controller = new StreamingConcurrencyController(CONCURRENCY_LIMIT);
  const playFromList = [];
  const playUrlList = [];
  const panCountMap = new Map();

  const parseTasks = itemsToParse.map((item, idx) => ({
    task: async () => {
      if (playFromList.length >= EARLY_RETURN_THRESHOLD) return { cancelled: true };
      const driveResult = await getDriveParseWithCache(item._link_url, item.driveKey, drives);
      if (!driveResult.data) return { success: false };
      return { success: true, data: driveResult.data, item, idx };
    },
    priority: idx
  }));

  for (const { task, priority } of parseTasks) {
    const result = await controller.add(task, priority);
    if (result.cancelled) continue;
    if (!result.success) continue;

    const { data, item } = result;
    const panKey = item.driveKey;
    const currentCount = panCountMap.get(panKey) || 0;
    if (currentCount >= MAX_LINES_PER_PAN) continue;
    if (isLineMostlySmallFiles(data.playUrl, SMALL_FILE_THRESHOLD_MB)) continue;

    const lineName = currentCount === 0 ? panKey : `${panKey}#${currentCount + 1}`;
    playFromList.push(lineName);

    let enhancedUrl = data.playUrl;
    if (seasonDetails && seasonDetails.length > 0) {
      enhancedUrl = enhancePlayUrlWithTitles(data.playUrl, tmdbInfo?.title || keyword, seasonDetails);
    } else {
      enhancedUrl = normalizeEpisodePlayUrl(data.playUrl, keyword);
    }
    playUrlList.push(enhancedUrl);
    panCountMap.set(panKey, currentCount + 1);
  }

  if (playFromList.length === 0) {
    log.warn(`[详情] 未能解析出任何有效线路`);
    return {
      vod_id: `hot_${keyword}`,
      vod_name: keyword,
      vod_pic: tmdbInfo?.pic || "",
      vod_remarks: "解析失败",
      vod_content: tmdbInfo?.intro || `《${keyword}》`,
      vod_play_from: "温馨提示",
      vod_play_url: "未找到有效播放资源$https://www.douban.com"
    };
  }

  return {
    vod_id: `hot_${keyword}`,
    vod_name: tmdbInfo?.title || keyword,
    vod_pic: (USE_TMDB_IMAGE && tmdbInfo?.pic) ? tmdbInfo.pic : "",
    vod_remarks: `${playFromList.length}个线路`,
    vod_content: tmdbInfo?.intro || `《${keyword}》`,
    vod_actor: tmdbInfo?.actors || "",
    vod_director: tmdbInfo?.directors || "",
    vod_year: tmdbInfo?.year || "",
    vod_play_from: playFromList.join('$$$'),
    vod_play_url: playUrlList.join('$$$')
  };
};

// 分类
const _category = async ({ id, page, filters, drives }) => {
  const pg = parseInt(page) || 1;
  log.info(`[分类] ${id}, 页码: ${pg}, 筛选: ${JSON.stringify(filters)}`);

  if (id && id.startsWith('drive_')) {
    const parts = id.split('_');
    if (parts.length >= 4) {
      const accountHash = parts[1];
      const driveKey = parts[2];
      const wd = decodeURIComponent(parts.slice(3).join('_'));

      log.info(`[分类] 网盘资源列表: ${driveKey}, 关键词: ${wd}, 账号: ${accountHash}`);

      const account = accounts.find(a => a.hash === accountHash);
      if (!account) {
        log.error(`[分类] 未找到账号: ${accountHash}`);
        return { list: [], page: pg, pagecount: 1, limit: 20, total: 0 };
      }

      const timer = createTimer();
      return await getPanResourceList(account, driveKey, wd, page, timer);
    }
  }

  for (const channel of HOT_CHANNELS) {
    if (id === channel.id) {
      log.info(`[分类] 热搜榜: ${channel.channel}, 页码 ${pg}`);
      const allItems = await fetchHotRanking(channel.channel);
      const total = allItems.length;
      const pageSize = 20;
      const start = (pg - 1) * pageSize;
      const pageItems = allItems.slice(start, start + pageSize);
      const list = pageItems.map(item => ({
        vod_id: `hot_${channel.channel}_${encodeURIComponent(item.title)}_${item.year || ''}`,
        vod_name: item.title,
        vod_pic: item.src || '',
        vod_remarks: `🔥${item.hot_score} | ${item.episode_count || '单集'}`,
        vod_year: item.year || '',
        vod_area: item.area || '',
        vod_type: item.category || ''
      }));
      log.info(`[分类] 返回 ${list.length} 条，总计 ${total} 条`);
      return {
        list,
        page: pg,
        pagecount: Math.ceil(total / pageSize) || 1,
        limit: pageSize,
        total
      };
    }
  }

  log.warn(`[分类] 未知分类ID: ${id}`);
  return { list: [], page: pg, pagecount: 1, limit: 20, total: 0 };
};

// 播放
const _play = async ({ flag, flags, id, drives }) => {
  log.info(`[播放] flag: ${flag}, id: ${id?.substring(0, 50)}`);

  if (id && id.startsWith('link://')) {
    const match = id.match(/^link:\/\/([^/]+)\/([^/]+)\/(.+)$/);
    if (match) {
      const [, accountHash, driveKey, encodedUrl] = match;
      const linkUrl = decodeURIComponent(encodedUrl);

      log.info(`[播放] 列表模式单链接: ${driveKey}, url: ${linkUrl.substring(0, 50)}..., 账号: ${accountHash}`);

      const drive = drives.find(o => o.key === driveKey);
      if (drive) {
        try {
          const result = await drive.play(linkUrl, flag);
          return result;
        } catch (error) {
          log.error(`[播放] 列表模式播放失败: ${error.message}`);
          return { error: `播放失败: ${error.message}` };
        }
      } else {
        log.warn(`[播放] 未找到驱动: ${driveKey}`);
      }
    }
  }

  let driveKey = flag;
  if (driveKey.includes('#')) driveKey = driveKey.split('#')[0];
  if (driveKey.includes('-')) driveKey = driveKey.split('-')[0];

  const drive = drives.find(o => o.key === driveKey);
  if (drive) {
    log.info(`[播放] 找到驱动: ${driveKey}`);
    try {
      const result = await drive.play(id, flag);
      return result;
    } catch (error) {
      log.error(`[播放] 驱动播放失败: ${error.message}`);
      return { error: `播放失败: ${error.message}` };
    }
  }

  log.info(`[播放] 未找到指定驱动: ${driveKey}，尝试遍历所有驱动`);
  for (const key of PAN_ORDER) {
    const d = drives.find(o => o.key === key);
    if (!d || !d.matchShare) continue;

    try {
      if (d.matchShare(id)) {
        log.info(`[播放] 找到匹配驱动: ${d.key}`);
        return await d.play(id, flag);
      }
    } catch (error) {
      log.info(`[播放] 驱动 ${d.key} 播放失败: ${error.message}`);
    }
  }

  return { error: "未找到对应的网盘驱动", flag, id };
};

// ===================== 并发控制辅助类 =====================
class StreamingConcurrencyController {
  constructor(limit) {
    this.limit = limit;
    this.running = 0;
    this.queue = [];
    this.results = [];
    this.completed = 0;
    this.errors = 0;
  }

  async add(task, priority = 0) {
    return new Promise((resolve) => {
      this.queue.push({ task, priority, resolve });
      this.queue.sort((a, b) => a.priority - b.priority);
      this.process();
    });
  }

  async process() {
    if (this.running >= this.limit || this.queue.length === 0) return;

    const { task, resolve } = this.queue.shift();
    this.running++;

    try {
      const result = await task();
      this.results.push(result);
      this.completed++;
      resolve(result);
    } catch (error) {
      this.errors++;
      resolve({ error: error.message, failed: true });
    } finally {
      this.running--;
      this.process();
    }
  }

  getStats() {
    return {
      running: this.running,
      completed: this.completed,
      errors: this.errors,
      pending: this.queue.length
    };
  }
}

// 耗时日志工具
class TimingLogger {
  constructor() {
    this.timings = [];
    this.startTime = Date.now();
    this.lastStepTime = this.startTime;
  }

  step(name, extraInfo = '') {
    const now = Date.now();
    const stepCost = now - this.lastStepTime;
    const totalCost = now - this.startTime;
    this.lastStepTime = now;
    this.timings.push({ step: name, stepCost, totalCost });
    log.info(`[⏱️ 耗时] ${name}: ${stepCost}ms (累计: ${totalCost}ms) ${extraInfo}`);
    return this;
  }

  concurrentStep(name, tasks, successCount, extraInfo = '') {
    const now = Date.now();
    const stepCost = now - this.lastStepTime;
    const totalCost = now - this.startTime;
    this.lastStepTime = now;
    log.info(`[⏱️ 耗时] ${name}: ${stepCost}ms (累计: ${totalCost}ms) | 任务:${tasks}, 成功:${successCount} ${extraInfo}`);
    return this;
  }

  cacheHit(type, key, extraInfo = '') {
    log.info(`[💾 缓存] ${type}命中: ${key} ${extraInfo}`);
    return this;
  }

  cacheMiss(type, key, extraInfo = '') {
    log.info(`[🔄 缓存] ${type}更新: ${key} ${extraInfo}`);
    return this;
  }

  summary(operation, resultInfo = '') {
    const totalCost = Date.now() - this.startTime;
    const steps = this.timings.map(t => `${t.step}:${t.stepCost}ms`).join(' → ');
    log.info(`[📊 汇总] ${operation} | 总耗时: ${totalCost}ms | ${steps} | ${resultInfo}`);
    return totalCost;
  }

  elapsed() { return Date.now() - this.startTime; }
}

const createTimer = () => new TimingLogger();

// 链接有效性校验
async function checkLinksValidity(links) {
  const startTime = Date.now();
  const uniqueLinks = [...new Set(links)];
  const validLinksSet = new Set();
  log.info(`[链接校验] 开始校验 ${uniqueLinks.length} 个链接`);
  try {
    const res = await axios.post(
      LINK_CHECK_URL,
      { links: uniqueLinks, selected_platforms: ["quark", "baidu", "xunlei", "tianyi", "pan115", "pan123", "aliyun", "uc", "pikpak"] },
      { timeout: 10000, headers: { "Content-Type": "application/json" } }
    );
    const checkData = res.data;
    const validLinks = checkData.valid_links || checkData.valid || [];
    validLinks.forEach(link => validLinksSet.add(link));
    const elapsed = Date.now() - startTime;
    log.info(`[链接校验] 完成，有效 ${validLinksSet.size}/${uniqueLinks.length}，耗时 ${elapsed}ms`);
  } catch (e) {
    const elapsed = Date.now() - startTime;
    log.warn(`[链接校验] 失败: ${e.message}，耗时 ${elapsed}ms，全部视为有效`);
    uniqueLinks.forEach(l => validLinksSet.add(l));
  }
  return validLinksSet;
}

// ===================== HTTP 客户端 =====================
const tmdbHttp = axios.create({
  timeout: 10000,
  headers: { "User-Agent": UA }
});

const fastHttp = axios.create({
  timeout: 15000,
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 20 }),
});

// ===================== 缓存 =====================
const searchCache = new Map();
const gyApiCache = new Map();
const detailCache = new Map();
const tmdbCache = new Map();
const driveParseCache = new Map();
const tmdbImageCache = new Map();
const tmdbSeasonsCache = new Map();
const hotCache = new Map();

const CACHE_TTL = {
  search: 5 * 60 * 1000,
  detail: 10 * 60 * 1000,
  tmdb: 24 * 60 * 60 * 1000,
  drive: 60 * 60 * 1000,
  image: 30 * 60 * 1000,
  seasons: 24 * 60 * 60 * 1000,
  gyApi: 5 * 60 * 1000,
  hot: 5 * 60 * 1000
};

// ===================== T4 协议处理 =====================
const decodeExt = (ext) => {
  if (!ext) return {};
  try {
    return JSON.parse(Buffer.from(ext, 'base64').toString('utf-8'));
  } catch (e) {
    try {
      return JSON.parse(ext);
    } catch (e2) {
      return {};
    }
  }
};

const handleT4Request = async (req) => {
  const { ids, id, wd, play, t, pg, ext } = req.query;
  const page = parseInt(pg) || 1;
  const drives = req.server?.drives || [];

  log.info(`[请求] ${req.url.substring(0, 100)}`);

  if (play) {
    return await _play({ flag: req.query.flag || '', flags: [], id: play, drives });
  }

  if (wd) {
    return await _search(wd, page, drives);
  }

  if ((ids || id) && (ids || id) !== "undefined") {
    const detailId = (ids || id).toString();
    const filters = decodeExt(ext);
    const title = filters.title || filters.wd || filters.name;
    const detail = await _detail(detailId, title, drives);
    return { list: detail ? [detail] : [], page: 1, pagecount: 1, total: 1 };
  }

  if (t) {
    const filters = decodeExt(ext);
    return await _category({ id: t, page, filters, drives });
  }

  return {
    class: HOT_CHANNELS.map(c => ({ type_id: c.id, type_name: c.name })),
    filters: {}
  };
};

// ===================== 模块导出 =====================
module.exports = async (server, opt) => {
  await init(server);

  const accountsConfig = opt?.accounts || ACCOUNTS;
  if (accountsConfig && accountsConfig.length) {
    // 后台初始化，不阻塞启动
    initAccounts(accountsConfig).catch(e => log.error(`后台初始化账号失败: ${e.message}`));
    // 延迟启动健康检查，等待账号池稳定
    setTimeout(() => startHealthCheck(), 5000);
  } else {
    log.warn(`[启动] 未配置任何账号，观影功能将无法使用`);
  }

  // 注册路由（原有代码保持不变）
  const apiPath = "/video/gy_pansou2";
  server.get(apiPath, async (req, reply) => {
    try {
      return await handleT4Request(req);
    } catch (error) {
      log.error(`[错误] ${error.message}`);
      return { error: "Internal Server Error", message: error.message };
    }
  });

  const statusPath = "/video/gy_pansou2/status";
  server.get(statusPath, async (req, reply) => {
    try {
      const accountInfo = accounts.map(acc => ({
        hash: acc.hash,
        baseUrl: acc.baseUrl,
        username: acc.username,
        logged_in: acc.logged_in,
        last_login: acc.last_login ? new Date(acc.last_login).toISOString() : null,
        last_check: acc.last_check ? new Date(acc.last_check).toISOString() : null
      }));
      return {
        success: true,
        total: accounts.length,
        available: accounts.filter(a => a.logged_in).length,
        currentIndex: currentAccountIndex,
        accounts: accountInfo
      };
    } catch (error) {
      log.error(`[状态路由] 错误: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  opt.sites.push({
    key: "gy_pansou2",
    name: "观影盘搜",
    type: 4,
    api: apiPath,
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
  });

  log.info(`✅ 观影追剧已加载 (可用账号数: ${accounts.filter(a => a.logged_in).length}/${accounts.length}, TMDB: ${TMDB_API_KEY ? "已配置" : "未配置"})`);
  log.info(`✅ 网盘标识: ${PAN_ORDER.join(', ')}`);
  log.info(`✅ TVBox列表模式: ${TVBOX_LIST_MODE ? "已启用" : "已禁用"}`);
  log.info(`✅ 状态查看路由: ${statusPath}`);
};