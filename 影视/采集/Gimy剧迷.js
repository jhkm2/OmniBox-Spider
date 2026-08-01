// @name Gimy剧迷
// @author 梦
// @description 影视站：Gimy / gimy.now / gimyai.tw，支持首页、分类、详情、搜索与播放页嗅探
// @dependencies cheerio,@types/opencc-js
// @version 1.2.6
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/Gimy剧迷.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

// ==================== 配置开始 ====================
// 是否禁用 OpenCC 等外部繁简转换库；环境变量 GIMY_DISABLE_OPENCC=1 时仅使用内置兜底映射。
const DISABLE_OPENCC = String(process.env.GIMY_DISABLE_OPENCC || "").trim() === "1";

// 播放线路排序环境配置；优先读取 GIMY_PLAY_SOURCE_ORDER，GIMY_SOURCE_ORDER 作为兼容别名。
const PLAY_SOURCE_ORDER_CONFIG = String(process.env.GIMY_PLAY_SOURCE_ORDER || process.env.GIMY_SOURCE_ORDER || "").trim();

// 站点基础地址，用于补全相对链接和发起默认请求。
const BASE_URL = "https://gimyai.tw";

// 请求使用的 User-Agent，避免站点返回移动端或拦截页面。
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

// 未设置播放线路排序环境变量时的默认优先线路，未命中的线路保持站点原始顺序。
const DEFAULT_PLAY_SOURCE_ORDER = ["4K画质线路 ᴴᴰ", "超清线路 ᴴᴰ"];
// ==================== 配置结束 ====================

let simplifyConverter = null;
let simplifyConverterName = "fallback-map";
let simplifyConverterChecked = false;

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function getBodyText(res) {
  const body = res && typeof res === "object" && "body" in res ? res.body : res;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.toString();
  return String(body || "");
}

async function requestText(url, options = {}) {
  await OmniBox.log("info", `[Gimy剧迷][request] ${options.method || "GET"} ${url}`);
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
  return getBodyText(res);
}

function absUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value.replace(/^\.\//, "")}`;
}

function normalizeText(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function fallbackTraditionalToSimplified(value) {
  const map = {
    "鬥": "斗", "羅": "罗", "陸": "陆", "龍": "龙", "傳": "传", "說": "说", "絕": "绝", "劍": "剑", "塵": "尘",
    "動": "动", "態": "态", "畫": "画", "劇": "剧", "場": "场", "國": "国", "產": "产", "綜": "综", "藝": "艺",
    "電": "电", "視": "视", "連": "连", "續": "续", "線": "线", "萬": "万", "與": "与", "風": "风", "雲": "云",
    "後": "后", "開": "开", "關": "关", "門": "门", "書": "书", "貓": "猫", "馬": "马", "魚": "鱼", "鳥": "鸟",
    "來": "来", "時": "时", "會": "会", "愛": "爱", "戰": "战", "雙": "双", "無": "无", "盡": "尽", "順": "顺",
    "極": "极", "歲": "岁", "當": "当", "這": "这", "個": "个", "們": "们", "為": "为", "總": "总", "實": "实",
    "陰": "阴", "陽": "阳", "聖": "圣", "靈": "灵", "夢": "梦", "戀": "恋", "網": "网", "寶": "宝", "藍": "蓝",
    "覺": "觉", "經": "经", "終": "终", "貝": "贝", "幾": "几", "體": "体", "頭": "头", "師": "师",
    "慶": "庆", "餘": "余", "館": "馆", "漢": "汉", "趙": "赵", "滄": "沧", "粵": "粤", "語": "语",
    "專": "专", "區": "区", "號": "号", "劃": "划", "燈": "灯", "貴": "贵", "顏": "颜", "廣": "广", "澤": "泽",
    "遲": "迟", "歡": "欢", "鱗": "鳞", "綺": "绮", "紀": "纪", "義": "义", "獄": "狱", "滬": "沪", "灣": "湾",
    "峽": "峡", "層": "层", "樓": "楼", "鹽": "盐", "澀": "涩", "歸": "归", "樂": "乐", "豐": "丰", "俠": "侠",
    "俁": "俣", "優": "优", "偉": "伟", "側": "侧", "僅": "仅", "價": "价", "儀": "仪", "億": "亿", "儲": "储",
    "兒": "儿", "剛": "刚", "劉": "刘", "勁": "劲", "勞": "劳", "勳": "勋", "匯": "汇", "華": "华", "協": "协",
    "單": "单", "衛": "卫", "廳": "厅", "厲": "厉", "壓": "压", "參": "参", "叢": "丛", "吳": "吴", "啟": "启",
    "喬": "乔", "喚": "唤", "嘆": "叹", "嘯": "啸", "噸": "吨", "嚴": "严", "園": "园", "團": "团", "圍": "围",
    "壘": "垒", "壞": "坏", "壯": "壮", "壽": "寿", "夠": "够", "夢": "梦", "奪": "夺", "奮": "奋", "奧": "奥",
    "奬": "奖", "婦": "妇", "媽": "妈", "嫻": "娴", "學": "学", "寧": "宁", "實": "实", "對": "对", "導": "导",
    "將": "将", "專": "专", "尋": "寻", "對": "对", "屆": "届", "岡": "冈", "島": "岛", "峯": "峰", "峽": "峡",
    "巔": "巅", "幣": "币", "幫": "帮", "幹": "干", "庫": "库", "廢": "废", "彈": "弹", "強": "强", "彥": "彦",
    "徑": "径", "徹": "彻", "憂": "忧", "應": "应", "懷": "怀", "懸": "悬", "懲": "惩", "戶": "户", "拋": "抛",
    "挾": "挟", "捨": "舍", "掃": "扫", "掄": "抡", "揚": "扬", "換": "换", "揮": "挥", "損": "损", "搖": "摇",
    "攝": "摄", "擁": "拥", "據": "据", "擇": "择", "擊": "击", "擋": "挡", "擾": "扰", "擴": "扩", "攝": "摄",
    "擺": "摆", "斂": "敛", "斃": "毙", "斕": "斓", "於": "于", "暈": "晕", "曉": "晓", "曆": "历", "曠": "旷",
    "曬": "晒", "曉": "晓", "書": "书", "朧": "胧", "殺": "杀", "條": "条", "梟": "枭", "棄": "弃", "榮": "荣",
    "槍": "枪", "槓": "杠", "樁": "桩", "橋": "桥", "機": "机", "檔": "档", "檢": "检", "歡": "欢", "歐": "欧",
    "歲": "岁", "殘": "残", "殿": "殿", "氣": "气", "決": "决", "沒": "没", "沖": "冲", "況": "况", "滾": "滚",
    "滿": "满", "潔": "洁", "潛": "潜", "澤": "泽", "濃": "浓", "濤": "涛", "濟": "济", "濱": "滨", "瀾": "澜",
    "灣": "湾", "營": "营", "爍": "烁", "爐": "炉", "爭": "争", "爾": "尔", "獨": "独", "獅": "狮", "獻": "献",
    "璣": "玑", "環": "环", "瓊": "琼", "甄": "甄", "產": "产", "當": "当", "瘋": "疯", "盜": "盗", "盤": "盘",
    "盧": "卢", "監": "监", "盪": "荡", "矚": "瞩", "矯": "矫", "硤": "硖", "礎": "础", "禍": "祸", "禦": "御",
    "禪": "禅", "種": "种", "稱": "称", "穀": "谷", "窩": "窝", "競": "竞", "筆": "笔", "築": "筑", "籃": "篮",
    "糰": "团", "糾": "纠", "紀": "纪", "約": "约", "級": "级", "紋": "纹", "納": "纳", "純": "纯", "紙": "纸",
    "紛": "纷", "素": "素", "紮": "扎", "紹": "绍", "終": "终", "組": "组", "細": "细", "結": "结", "絃": "弦",
    "給": "给", "絕": "绝", "統": "统", "絲": "丝", "經": "经", "綁": "绑", "維": "维", "綱": "纲", "網": "网",
    "緊": "紧", "緒": "绪", "練": "练", "縣": "县", "縱": "纵", "總": "总", "績": "绩", "織": "织", "繞": "绕",
    "繼": "继", "續": "续", "罷": "罢", "羋": "芈", "習": "习", "翹": "翘", "翻": "翻", "聯": "联", "聲": "声",
    "職": "职", "肅": "肃", "腦": "脑", "腳": "脚", "脈": "脉", "腫": "肿", "臺": "台", "艦": "舰", "艱": "艰",
    "艷": "艳", "藝": "艺", "節": "节", "莊": "庄", "蒼": "苍", "蓋": "盖", "蓮": "莲", "蔣": "蒋", "蕭": "萧",
    "薩": "萨", "藥": "药", "虜": "虏", "號": "号", "蛻": "蜕", "蝕": "蚀", "衛": "卫", "補": "补", "裝": "装",
    "複": "复", "襲": "袭", "覈": "核", "覓": "觅", "覽": "览", "觸": "触", "訂": "订", "訃": "讣", "計": "计",
    "訊": "讯", "託": "托", "記": "记", "訓": "训", "訴": "诉", "診": "诊", "詐": "诈", "詔": "诏", "評": "评",
    "詞": "词", "詠": "咏", "詢": "询", "試": "试", "詩": "诗", "話": "话", "該": "该", "詳": "详", "誅": "诛",
    "誠": "诚", "誤": "误", "說": "说", "誰": "谁", "課": "课", "調": "调", "談": "谈", "請": "请", "諒": "谅",
    "諜": "谍", "諾": "诺", "謀": "谋", "謊": "谎", "謎": "谜", "講": "讲", "謝": "谢", "譚": "谭", "譜": "谱",
    "譯": "译", "議": "议", "護": "护", "讀": "读", "變": "变", "讓": "让", "豐": "丰", "貓": "猫", "貫": "贯",
    "責": "责", "貧": "贫", "貨": "货", "販": "贩", "貪": "贪", "貫": "贯", "賀": "贺", "賈": "贾", "資": "资",
    "賊": "贼", "賓": "宾", "賜": "赐", "賞": "赏", "賠": "赔", "賢": "贤", "賣": "卖", "質": "质", "賴": "赖",
    "贈": "赠", "贏": "赢", "趕": "赶", "趙": "赵", "跡": "迹", "踐": "践", "踴": "踊", "蹟": "迹", "車": "车",
    "軌": "轨", "軍": "军", "軟": "软", "較": "较", "輛": "辆", "輝": "辉", "輩": "辈", "輪": "轮", "輯": "辑",
    "輸": "输", "轟": "轰", "辦": "办", "邁": "迈", "還": "还", "邊": "边", "郵": "邮", "鄉": "乡", "鄧": "邓",
    "鄭": "郑", "醜": "丑", "醫": "医", "醬": "酱", "釀": "酿", "釋": "释", "針": "针", "鈴": "铃", "鈺": "钰",
    "鉅": "巨", "鉤": "钩", "銀": "银", "銃": "铳", "銅": "铜", "銘": "铭", "銳": "锐", "鋒": "锋", "錘": "锤",
    "錦": "锦", "鍋": "锅", "鎖": "锁", "鐘": "钟", "鐵": "铁", "鑄": "铸", "鑑": "鉴", "長": "长", "門": "门",
    "開": "开", "閃": "闪", "閉": "闭", "問": "问", "聞": "闻", "閩": "闽", "閣": "阁", "闖": "闯", "關": "关",
    "陣": "阵", "陽": "阳", "際": "际", "雜": "杂", "離": "离", "難": "难", "雲": "云", "雷": "雷", "霧": "雾",
    "靜": "静", "響": "响", "頂": "顶", "頃": "顷", "項": "项", "順": "顺", "須": "须", "頑": "顽", "頓": "顿",
    "頒": "颁", "頗": "颇", "領": "领", "頭": "头", "頰": "颊", "顆": "颗", "顧": "顾", "顫": "颤", "顯": "显",
    "顱": "颅", "顴": "颧", "風": "风", "飛": "飞", "飯": "饭", "飲": "饮", "飼": "饲", "館": "馆", "駁": "驳",
    "駕": "驾", "騎": "骑", "騙": "骗", "騰": "腾", "驅": "驱", "驗": "验", "驚": "惊", "髒": "脏", "鬚": "须",
    "鬧": "闹", "鬱": "郁", "魚": "鱼", "魯": "鲁", "鮑": "鲍", "鮮": "鲜", "鯨": "鲸", "鳴": "鸣", "鷹": "鹰",
    "麗": "丽", "麥": "麦", "黃": "黄", "點": "点", "黨": "党", "齊": "齐", "齒": "齿", "龍": "龙"
  };
  return String(value || "").split("").map((ch) => map[ch] || ch).join("");
}

function getSimplifyConverter() {
  if (simplifyConverterChecked) return simplifyConverter;
  simplifyConverterChecked = true;

  if (DISABLE_OPENCC) {
    simplifyConverterName = "fallback-map";
    simplifyConverter = fallbackTraditionalToSimplified;
    return simplifyConverter;
  }

  try {
    const conv = require("chinese-conv");
    if (conv && typeof conv.sify === "function") {
      simplifyConverterName = "chinese-conv";
      simplifyConverter = (text) => conv.sify(String(text || ""));
      return simplifyConverter;
    }
  } catch (_) {}

  try {
    const rsOpencc = require("@node-rs/opencc");
    if (rsOpencc && typeof rsOpencc.t2s === "function") {
      simplifyConverterName = "@node-rs/opencc:t2s";
      simplifyConverter = (text) => rsOpencc.t2s(String(text || ""));
      return simplifyConverter;
    }
    if (rsOpencc && typeof rsOpencc.OpenCC === "function") {
      const cc = new rsOpencc.OpenCC("t2s.json");
      if (typeof cc.convertSync === "function") {
        simplifyConverterName = "@node-rs/opencc:OpenCC";
        simplifyConverter = (text) => cc.convertSync(String(text || ""));
        return simplifyConverter;
      }
    }
  } catch (_) {}

  try {
    const openccJs = require("opencc-js");
    if (openccJs && typeof openccJs.Converter === "function") {
      const converter = openccJs.Converter({ from: "t", to: "cn" });
      if (typeof converter === "function") {
        simplifyConverterName = "opencc-js";
        simplifyConverter = (text) => converter(String(text || ""));
        return simplifyConverter;
      }
    }
  } catch (_) {}

  try {
    const opencc = require("opencc");
    if (opencc && typeof opencc.OpenCC === "function") {
      const cc = new opencc.OpenCC("t2s.json");
      if (typeof cc.convertSync === "function") {
        simplifyConverterName = "opencc:convertSync";
        simplifyConverter = (text) => cc.convertSync(String(text || ""));
        return simplifyConverter;
      }
    }
    if (opencc && typeof opencc.t2s === "function") {
      simplifyConverterName = "opencc:t2s";
      simplifyConverter = (text) => opencc.t2s(String(text || ""));
      return simplifyConverter;
    }
  } catch (_) {}

  simplifyConverterName = "fallback-map";
  simplifyConverter = fallbackTraditionalToSimplified;
  return simplifyConverter;
}

function convertTraditionalToSimplified(value) {
  const text = String(value || "");
  try {
    const converter = getSimplifyConverter();
    const result = converter ? converter(text) : text;
    return String(result || text);
  } catch (_) {
    simplifyConverterName = "fallback-map";
    return fallbackTraditionalToSimplified(text);
  }
}

function toDisplayText(value) {
  return convertTraditionalToSimplified(normalizeText(value));
}

function parsePlaySourceOrderConfig() {
  const raw = PLAY_SOURCE_ORDER_CONFIG;
  if (!raw) return DEFAULT_PLAY_SOURCE_ORDER;

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    } catch (_) {}
  }

  return raw.split(/[,\n|;]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizePlaySourceKey(value) {
  return toDisplayText(value)
    .replace(/[ᴴＨｈ]/g, "H")
    .replace(/[ᴰＤｄ]/g, "D")
    .replace(/\s+/g, "")
    .replace(/HD$/i, "")
    .toLowerCase();
}

function getPlaySourceOrderMap() {
  const orderMap = new Map();
  parsePlaySourceOrderConfig().forEach((name, index) => {
    const key = normalizePlaySourceKey(name);
    if (key && !orderMap.has(key)) orderMap.set(key, index);
  });
  return orderMap;
}

function sortPlaySources(playSources) {
  const orderMap = getPlaySourceOrderMap();
  if (!orderMap.size) return playSources;

  return playSources
    .map((source, index) => ({ source, index, order: orderMap.get(normalizePlaySourceKey(source.name)) }))
    .sort((a, b) => {
      const aConfigured = Number.isInteger(a.order);
      const bConfigured = Number.isInteger(b.order);
      if (aConfigured && bConfigured) return a.order - b.order || a.index - b.index;
      if (aConfigured) return -1;
      if (bConfigured) return 1;
      return a.index - b.index;
    })
    .map((item) => item.source);
}

function normalizeSearchKeyword(value) {
  return convertTraditionalToSimplified(String(value || ""))
    .replace(/[\s\-_—–·•:：,，.。!?！？'"“”‘’()（）\[\]【】{}]/g, "")
    .toLowerCase();
}

function buildSearchTokens(keyword) {
  const base = normalizeSearchKeyword(keyword);
  if (!base) return [];
  const tokens = new Set([base]);
  const simplified = base
    .replace(/線上看|线上看|全集|連續劇|连续剧|電視劇|电视剧|動漫|动漫|電影|电影|綜藝|综艺/g, "")
    .trim();
  if (simplified) tokens.add(simplified);
  const digitStripped = simplified.replace(/第\d+[集季部篇]?$/g, "").replace(/\d+$/g, "");
  if (digitStripped) tokens.add(digitStripped);
  return [...tokens].filter(Boolean).sort((a, b) => b.length - a.length);
}

function scoreSearchResult(vodName, keyword) {
  const name = normalizeSearchKeyword(vodName);
  const tokens = buildSearchTokens(keyword);
  if (!name || !tokens.length) return 0;

  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (name === token) score = Math.max(score, 1000 + token.length);
    else if (name.startsWith(token)) score = Math.max(score, 800 + token.length);
    else if (name.includes(token)) score = Math.max(score, 600 + token.length);
    else if (token.includes(name) && name.length >= 2) score = Math.max(score, 450 + name.length);
  }
  return score;
}

function extractCards($, scope) {
  const list = [];
  const seen = new Set();
  const $scope = scope && scope.length ? scope : $.root();

  $scope.find("a[href*='/detail/']").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";
    const vod_id = absUrl(href);
    if (!/\/detail\/\d+\.html/i.test(vod_id) || seen.has(vod_id)) return;

    const title = toDisplayText(
      $el.attr("title")
      || $el.find("img").attr("alt")
      || $el.find(".title, .video-text, .module-poster-item-title, h3, h4, h5").first().text()
      || $el.text()
    );
    if (!title) return;

    const pic = absUrl(
      $el.attr("data-original")
      || $el.attr("data-src")
      || $el.attr("data-bg")
      || $el.find("img").attr("data-original")
      || $el.find("img").attr("data-src")
      || $el.find("img").attr("src")
      || $el.closest(".module-item, li, .public-list-box, .video-item, .item, .col-md-2, .col-sm-3, .col-xs-4").find("a.video-pic").first().attr("data-original")
      || $el.closest(".module-item, li, .public-list-box, .video-item, .item, .col-md-2, .col-sm-3, .col-xs-4").find("a.video-pic").first().attr("data-src")
      || $el.closest(".module-item, li, .public-list-box, .video-item, .item, .col-md-2, .col-sm-3, .col-xs-4").find("img").first().attr("data-original")
      || $el.closest(".module-item, li, .public-list-box, .video-item, .item, .col-md-2, .col-sm-3, .col-xs-4").find("img").first().attr("data-src")
      || $el.closest(".module-item, li, .public-list-box, .video-item, .item, .col-md-2, .col-sm-3, .col-xs-4").find("img").first().attr("src")
      || ""
    );
    const parentHtml = $el.closest("li, .module-item, .public-list-box, .video-item, .item, .module-poster-item, .myui-vodlist__box").html() || $el.parent().html() || "";
    const remarksMatch = String(parentHtml).match(/(?:更新至第?\d+集|更新第?\d+集|\(?\d+全\)?|全\d+集|已完結|已完结|HD中字|HD|TC|HC|搶先版|抢先版)/i);
    const vod_remarks = remarksMatch ? toDisplayText(remarksMatch[0]) : "";

    seen.add(vod_id);
    list.push({ vod_id, vod_name: title, vod_pic: pic, vod_remarks });
  });

  return list;
}

function buildClassAndFilters() {
  return {
    class: [
      { type_id: "1", type_name: "电影" },
      { type_id: "2", type_name: "电视剧" },
      { type_id: "4", type_name: "动漫" },
      { type_id: "29", type_name: "综艺" },
      { type_id: "34", type_name: "短剧" },
      { type_id: "13", type_name: "陆剧" },
    ],
    filters: {
      "1": [
        { key: "by", name: "排序", init: "time", value: [{ name: "最新", value: "time" }, { name: "人气", value: "hits" }, { name: "评分", value: "score" }] },
      ],
      "2": [
        { key: "by", name: "排序", init: "time", value: [{ name: "最新", value: "time" }, { name: "人气", value: "hits" }, { name: "评分", value: "score" }] },
      ],
      "4": [
        { key: "by", name: "排序", init: "time", value: [{ name: "最新", value: "time" }, { name: "人气", value: "hits" }, { name: "评分", value: "score" }] },
      ],
      "29": [
        { key: "by", name: "排序", init: "time", value: [{ name: "最新", value: "time" }, { name: "人气", value: "hits" }, { name: "评分", value: "score" }] },
      ],
      "34": [
        { key: "by", name: "排序", init: "time", value: [{ name: "最新", value: "time" }, { name: "人气", value: "hits" }, { name: "评分", value: "score" }] },
      ],
      "13": [
        { key: "by", name: "排序", init: "time", value: [{ name: "最新", value: "time" }, { name: "人气", value: "hits" }, { name: "评分", value: "score" }] },
      ],
    },
  };
}

async function home(params, context) {
  try {
    getSimplifyConverter();
    await OmniBox.log("info", `[Gimy剧迷][display] simplifyConverter=${simplifyConverterName}`);
    const config = buildClassAndFilters();
    const html = await requestText(`${BASE_URL}/`);
    const $ = cheerio.load(html);
    const list = extractCards($).slice(0, 24);
    await OmniBox.log("info", `[Gimy剧迷][home] 推荐数: ${list.length}`);
    return { class: config.class, filters: config.filters, list };
  } catch (e) {
    await OmniBox.log("error", `[Gimy剧迷][home] ${e.message}`);
    const config = buildClassAndFilters();
    return { class: config.class, filters: config.filters, list: [] };
  }
}

async function category(params, context) {
  try {
    const page = Math.max(Number(params.page || 1) || 1, 1);
    const categoryId = String(params.categoryId || params.type_id || "2");
    const filters = params.filters || {};
    const by = String(filters.by || "time");
    const url = `${BASE_URL}/genre/${categoryId}.html${page > 1 || by !== "time" ? `?page=${page}&by=${encodeURIComponent(by)}` : ""}`;
    const html = await requestText(url);
    const $ = cheerio.load(html);
    const list = extractCards($);
    await OmniBox.log("info", `[Gimy剧迷][category] type=${categoryId} page=${page} list=${list.length}`);
    return {
      page,
      pagecount: page + (list.length >= 20 ? 1 : 0),
      total: page * 20 + list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[Gimy剧迷][category] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

function collectPlaylistEpisodes($, scope) {
  const episodes = [];
  const seen = new Set();
  $(scope).find("a[href*='/play/']").each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const playId = absUrl(href);
    if (!playId || seen.has(playId)) return;
    const epName = toDisplayText($a.text()) || "正片";
    seen.add(playId);
    episodes.push({ name: epName, playId });
  });
  return episodes;
}

function parsePlaySources($) {
  const tabs = [];
  const seenTabs = new Set();
  $("#playTab a[href^='#con_playlist_']").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";
    const tabId = href.replace(/^#/, "");
    const name = toDisplayText($el.text()) || tabId;
    if (tabId && !seenTabs.has(tabId)) {
      seenTabs.add(tabId);
      tabs.push({ tabId, name });
    }
  });

  const playSources = [];
  for (const tab of tabs) {
    let episodes = [];
    $("[id]").filter((_, el) => String($(el).attr("id") || "") === tab.tabId).each((_, playlist) => {
      const candidate = collectPlaylistEpisodes($, playlist);
      if (candidate.length > episodes.length) episodes = candidate;
    });
    if (episodes.length) playSources.push({ name: tab.name, episodes });
  }
  return sortPlaySources(playSources);
}

function pickInfo(html, label) {
  const re = new RegExp(`<span[^>]*>${label}[：:]<\\/span>([\\s\\S]*?)<\\/li>`, "i");
  const m = String(html || "").match(re);
  if (!m) return "";
  return toDisplayText(m[1]);
}

async function detail(params, context) {
  try {
    const videoId = String(params.videoId || params.id || params.vod_id || "").trim();
    if (!videoId) return { list: [] };
    const url = /^https?:\/\//i.test(videoId) ? videoId : absUrl(videoId);
    const html = await requestText(url);
    const $ = cheerio.load(html);

    const vod_name = toDisplayText($("h1.text-overflow, h1").first().text() || $("title").text().split("線上看")[0]);
    const vod_pic = absUrl($("meta[property='og:image']").attr("content") || $(".details-pic .video-pic").attr("style")?.match(/url\(([^)]+)\)/)?.[1] || $("img").first().attr("src") || "");
    const vod_content = toDisplayText($(".switch-box .text, .details-content .text, .details-content, .detail-sketch").first().text() || $("meta[name='description']").attr("content") || "");
    const vod_remarks = pickInfo(html, "狀態") || pickInfo(html, "状态");
    const type_name = pickInfo(html, "類別") || pickInfo(html, "类别");
    const vod_year = pickInfo(html, "年代") || pickInfo(html, "年份");
    const vod_area = pickInfo(html, "國家/地區") || pickInfo(html, "国家/地区");
    const vod_actor = toDisplayText($("li:contains('主演') a").map((_, el) => $(el).text()).get().join(" / "));
    const vod_director = toDisplayText($("li:contains('導演') a, li:contains('导演') a").map((_, el) => $(el).text()).get().join(" / "));
    const vod_play_sources = parsePlaySources($);

    await OmniBox.log("info", `[Gimy剧迷][detail] ${url} 线路=${vod_play_sources.length}`);
    return {
      list: [{
        vod_id: url,
        vod_name,
        vod_pic,
        vod_content,
        vod_remarks,
        type_name,
        vod_year,
        vod_area,
        vod_actor,
        vod_director,
        vod_play_sources,
      }],
    };
  } catch (e) {
    await OmniBox.log("error", `[Gimy剧迷][detail] ${e.message}`);
    return { list: [] };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params.keyword || params.key || params.wd || "").trim();
    const page = Math.max(Number(params.page || 1) || 1, 1);
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };

    const url = `${BASE_URL}/find/-------------.html?wd=${encodeURIComponent(keyword)}&page=${page}`;
    const html = await requestText(url);
    const $ = cheerio.load(html);
    const scope = $(".box-main-content").first();
    const list = extractCards($, scope);
    await OmniBox.log("info", `[Gimy剧迷][search] keyword=${keyword} page=${page} scope=.box-main-content list=${list.length}`);
    return {
      page,
      pagecount: page + (list.length >= 20 ? 1 : 0),
      total: list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[Gimy剧迷][search] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function play(params, context) {
  try {
    const playId = String(params.playId || params.id || params.url || "").trim();
    if (!playId) return { parse: 0, urls: [], url: "", header: {}, headers: {} };

    const pageUrl = /^https?:\/\//i.test(playId) ? playId : absUrl(playId);
    const baseHeaders = { "User-Agent": UA, "Referer": pageUrl, "Origin": BASE_URL };
    await OmniBox.log("info", `[Gimy剧迷][play] start pageUrl=${pageUrl}`);

    let playerData = null;
    try {
      const html = await requestText(pageUrl, { referer: pageUrl });
      const m = html.match(/var\s+player_data\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i);
      if (m) {
        await OmniBox.log("info", `[Gimy剧迷][play] player_data=${m[1].slice(0, 500)}`);
        playerData = JSON.parse(m[1]);
      }
    } catch (e) {
      await OmniBox.log("warn", `[Gimy剧迷][play] 读取播放页失败: ${e.message}`);
    }

    if (playerData && playerData.url) {
      const rawUrl = String(playerData.url || "");
      const playFrom = String(playerData.from || "");
      let parseBase = "https://play.gimyai.tw/v/";
      let referer = `https://play.gimyai.tw/v/?url=${encodeURIComponent(rawUrl)}`;

      if (["JD4K", "JD2K", "JDHG", "JDQM"].includes(playFrom)) {
        parseBase = "https://play.gimyai.tw/d/";
        referer = `https://play.gimyai.tw/d/?url=${encodeURIComponent(rawUrl)}&jctype=${encodeURIComponent(playFrom)}&next=${encodeURIComponent(`//${pageUrl}`)}`;
      } else if (playFrom === "NSYS") {
        parseBase = "https://play.gimyai.tw/n/";
        referer = `https://play.gimyai.tw/n/?url=${encodeURIComponent(rawUrl)}&jctype=${encodeURIComponent(playFrom)}&next=${encodeURIComponent(pageUrl)}`;
      }

      const parseUrl = `${parseBase}parse.php?url=${encodeURIComponent(rawUrl)}&_t=${Date.now()}`;
      await OmniBox.log("info", `[Gimy剧迷][play] parseUrl=${parseUrl}`);

      try {
        const parseText = await requestText(parseUrl, {
          referer,
          headers: {
            Accept: "application/json, text/plain, */*",
          },
        });
        await OmniBox.log("info", `[Gimy剧迷][play] parseResponse=${parseText.slice(0, 500)}`);
        let parseJson = null;
        try {
          parseJson = JSON.parse(parseText);
        } catch (_) {}

        const mediaUrl = String(parseJson?.url || parseJson?.video || parseJson?.playurl || "").trim();
        const mediaType = String(parseJson?.type || "").trim();
        if (mediaUrl) {
          const header = {
            "User-Agent": UA,
            Referer: referer,
            Origin: new URL(parseBase).origin,
          };
          return {
            parse: 0,
            url: mediaUrl,
            urls: [{ name: toDisplayText(playFrom) || "直链播放", url: mediaUrl }],
            header,
            headers: header};
        }
      } catch (e) {
        await OmniBox.log("warn", `[Gimy剧迷][play] parse.php failed: ${e.message}`);
      }
    }

    try {
      const sniffed = await OmniBox.sniffVideo(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
      await OmniBox.log("info", `[Gimy剧迷][play] sniff result=${JSON.stringify(sniffed || {})}`);
      if (sniffed && sniffed.url) {
        const header = sniffed.header || baseHeaders;
        return {
          parse: 0,
          url: sniffed.url,
          urls: [{ name: "嗅探播放", url: sniffed.url }],
          header,
          headers: header};
      }
    } catch (e) {
      await OmniBox.log("warn", `[Gimy剧迷][play] sniffVideo failed: ${e.message}`);
    }

    return {
      parse: 1,
      url: pageUrl,
      urls: [{ name: "播放页", url: pageUrl }],
      header: baseHeaders,
      headers: baseHeaders};
  } catch (e) {
    await OmniBox.log("error", `[Gimy剧迷][play] ${e.message}`);
    return { parse: 0, urls: [], url: "", header: {}, headers: {} };
  }
}
