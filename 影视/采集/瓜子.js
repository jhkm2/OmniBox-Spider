// @name 瓜子APP
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @version 1.1.0
// @dependencies: axios, crypto
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/瓜子.js

/**
 * ============================================================================
 * 瓜子APP - OmniBox 爬虫脚本
 * ============================================================================
 *
 * 对齐最新 Guazi 协议（2026-07）：动态 token + 新 AES/headers/多域名
 * ============================================================================
 */

const OmniBox = require("omnibox_sdk");
const crypto = require("crypto");
const axios = require("axios");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * 对齐最新 Guazi Java 源（2026-07）：动态 token + 新 AES/headers
 */
const API_HOSTS = [
    "https://apinew.uozvr.com",
    "https://api.w32z7vtd.com",
    "https://api.6a7nnf7.com",
    "https://api.umygrx3.com",
    "https://api.rmedphk.com",
];

const AES_KEY = "OITxa5OqAYjhswxx";
const AES_IV = "rCMNwZASNBKZ8mXV";
const DEVICE_OLD_KEY = "aLFBMWpxBrIDAD1Si/KVvm41";
const RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDUM5+/y8sPsWkd1/RQS64X259E
UwxFXFE5HlA65MqrxnPs0JqoSRojSDy5QhwvROlaD6TwRQHKMY2OAZ6SnQeUJsCh
TEFIR9qUkwrs3/MVUMxjsv6JS6Oe/juclyJGTgVmDhB55EafXsD0SQYVj/QXXsxR
6ewR5E2kL52yAAD4yQIDAQAB
-----END PUBLIC KEY-----`;
const RSA_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIICdgIBADANBgkqhkiG9w0BAQEFAASCAmAwggJcAgEAAoGAe6hKrWLi1zQmjTT1
ozbE4QdFeJGNxubxld6GrFGximxfMsMB6BpJhpcTouAqywAFppiKetUBBbXwYsYU
1wNr648XVmPmCMCy4rY8vdliFnbMUj086DU6Z+/oXBdWU3/b1G0DN3E9wULRSwcK
ZT3wj/cCI1vsCm3gj2R5SqkA9Y0CAwEAAQKBgAJH+4CxV0/zBVcLiBCHvSANm0l7
HetybTh/j2p0Y1sTXro4ALwAaCTUeqdBjWiLSo9lNwDHFyq8zX90+gNxa7c5EqcW
V9FmlVXr8VhfBzcZo1nXeNdXFT7tQ2yah/odtdcx+vRMSGJd1t/5k5bDd9wAvYdI
DblMAg+wiKKZ5KcdAkEA1cCakEN4NexkF5tHPRrR6XOY/XHfkqXxEhMqmNbB9U34
saTJnLWIHC8IXys6Qmzz30TtzCjuOqKRRy+FMM4TdwJBAJQZFPjsGC+RqcG5UvVM
iMPhnwe/bXEehShK86yJK/g/UiKrO87h3aEu5gcJqBygTq3BBBoH2md3pr/W+hUM
WBsCQQChfhTIrdDinKi6lRxrdBnn0Ohjg2cwuqK5zzU9p/N+S9x7Ck8wUI53DKm8
jUJE8WAG7WLj/oCOWEh+ic6NIwTdAkEAj0X8nhx6AXsgCYRql1klbqtVmL8+95KZ
K7PnLWG/IfjQUy3pPGoSaZ7fdquG8bq8oyf5+dzjE/oTXcByS+6XRQJAP/5ciy1b
L3NhUhsaOVy55MHXnPjdcTX0FaLi+ybXZIfIQ2P4rb19mVq1feMbCXhz+L1rG8oa
t5lYKfpe8k83ZA==
-----END PRIVATE KEY-----`;

const PLAY_UA = "Lavf/57.83.100";
const PLAY_REFERER = "http://WJiZxLXA2.com/";
const AUTH_FILE = process.env.GUAZI_AUTH_FILE || path.join(os.tmpdir(), "guazi_auth.json");
const DANMU_API = process.env.DANMU_API || "";

const state = {
    apiHost: API_HOSTS[0],
    token: "",
    tokenId: "",
    deviceId: "",
    deviceKey: "",
    registered: false,
    tokenReady: false,
    hostReady: false,
};

/**
 * 分类配置
 */
const CLASSES = [
    { type_id: "1", type_name: "电影" },
    { type_id: "2", type_name: "电视剧" },
    { type_id: "4", type_name: "动漫" },
    { type_id: "3", type_name: "综艺" },
    { type_id: "64", type_name: "短剧" }
];

/**
 * Java SUB_MAP
 */
const SUB_MAP = {
    "1": "5",
    "2": "12",
    "3": "30",
    "4": "22",
    "64": "",
    "5": "0",
};

/**
 * 筛选配置
 */
const FILTERS = {
    '1': [
        {
            key: 'year',
            name: '年份',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '2026', value: '2026' },
                { name: '2025', value: '2025' },
                { name: '2024', value: '2024' },
                { name: '2023', value: '2023' },
                { name: '2022', value: '2022' },
                { name: '2021', value: '2021' },
                { name: '2020', value: '2020' },
                { name: '2019', value: '2019' },
                { name: '2018', value: '2018' },
                { name: '2017', value: '2017' },
                { name: '2016', value: '2016' },
                { name: '2015', value: '2015' },
                { name: '2014', value: '2014' },
                { name: '2013', value: '2013' },
                { name: '2012', value: '2012' },
                { name: '2011', value: '2011' },
                { name: '2010', value: '2010' },
                { name: '2009', value: '2009' },
                { name: '2008', value: '2008' },
                { name: '2007', value: '2007' },
                { name: '2006', value: '2006' },
                { name: '2005', value: '2005' },
                { name: '更早', value: '2004' }
            ]
        },
        {
            key: 'area',
            name: '地区',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '大陆', value: '大陆' },
                { name: '香港', value: '香港' },
                { name: '台湾', value: '台湾' },
                { name: '美国', value: '美国' },
                { name: '韩国', value: '韩国' },
                { name: '日本', value: '日本' },
                { name: '英国', value: '英国' },
                { name: '法国', value: '法国' },
                { name: '泰国', value: '泰国' },
                { name: '印度', value: '印度' },
                { name: '其他', value: '其他' }
            ]
        },
        {
            key: 'sort',
            name: '排序',
            init: 'd_id',
            value: [
                { name: '最新', value: 'd_id' },
                { name: '最热', value: 'd_hits' },
                { name: '推荐', value: 'd_score' }
            ]
        }
    ],
    '2': [
        {
            key: 'year',
            name: '年份',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '2026', value: '2026' },
                { name: '2025', value: '2025' },
                { name: '2024', value: '2024' },
                { name: '2023', value: '2023' },
                { name: '2022', value: '2022' },
                { name: '2021', value: '2021' },
                { name: '2020', value: '2020' },
                { name: '2019', value: '2019' },
                { name: '2018', value: '2018' },
                { name: '2017', value: '2017' },
                { name: '2016', value: '2016' },
                { name: '2015', value: '2015' },
                { name: '2014', value: '2014' },
                { name: '2013', value: '2013' },
                { name: '2012', value: '2012' },
                { name: '2011', value: '2011' },
                { name: '2010', value: '2010' },
                { name: '2009', value: '2009' },
                { name: '2008', value: '2008' },
                { name: '2007', value: '2007' },
                { name: '2006', value: '2006' },
                { name: '2005', value: '2005' },
                { name: '更早', value: '2004' }
            ]
        },
        {
            key: 'area',
            name: '地区',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '大陆', value: '大陆' },
                { name: '香港', value: '香港' },
                { name: '台湾', value: '台湾' },
                { name: '美国', value: '美国' },
                { name: '韩国', value: '韩国' },
                { name: '日本', value: '日本' },
                { name: '英国', value: '英国' },
                { name: '法国', value: '法国' },
                { name: '泰国', value: '泰国' },
                { name: '印度', value: '印度' },
                { name: '其他', value: '其他' }
            ]
        },
        {
            key: 'sort',
            name: '排序',
            init: 'd_id',
            value: [
                { name: '最新', value: 'd_id' },
                { name: '最热', value: 'd_hits' },
                { name: '推荐', value: 'd_score' }
            ]
        }
    ],
    '4': [
        {
            key: 'year',
            name: '年份',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '2026', value: '2026' },
                { name: '2025', value: '2025' },
                { name: '2024', value: '2024' },
                { name: '2023', value: '2023' },
                { name: '2022', value: '2022' },
                { name: '2021', value: '2021' },
                { name: '2020', value: '2020' },
                { name: '2019', value: '2019' },
                { name: '2018', value: '2018' },
                { name: '2017', value: '2017' },
                { name: '2016', value: '2016' },
                { name: '2015', value: '2015' }
            ]
        },
        {
            key: 'area',
            name: '地区',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '大陆', value: '大陆' },
                { name: '日本', value: '日本' },
                { name: '美国', value: '美国' },
                { name: '其他', value: '其他' }
            ]
        },
        {
            key: 'sort',
            name: '排序',
            init: 'd_id',
            value: [
                { name: '最新', value: 'd_id' },
                { name: '最热', value: 'd_hits' },
                { name: '推荐', value: 'd_score' }
            ]
        }
    ],
    '3': [
        {
            key: 'year',
            name: '年份',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '2026', value: '2026' },
                { name: '2025', value: '2025' },
                { name: '2024', value: '2024' },
                { name: '2023', value: '2023' },
                { name: '2022', value: '2022' }
            ]
        },
        {
            key: 'area',
            name: '地区',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '大陆', value: '大陆' },
                { name: '台湾', value: '台湾' },
                { name: '韩国', value: '韩国' }
            ]
        },
        {
            key: 'sort',
            name: '排序',
            init: 'd_id',
            value: [
                { name: '最新', value: 'd_id' },
                { name: '最热', value: 'd_hits' },
                { name: '推荐', value: 'd_score' }
            ]
        }
    ],
    '64': [
        {
            key: 'year',
            name: '年份',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '2026', value: '2026' },
                { name: '2025', value: '2025' },
                { name: '2024', value: '2024' },
                { name: '2023', value: '2023' }
            ]
        },
        {
            key: 'sort',
            name: '排序',
            init: 'd_id',
            value: [
                { name: '最新', value: 'd_id' },
                { name: '最热', value: 'd_hits' },
                { name: '推荐', value: 'd_score' }
            ]
        }
    ]
};

/**
 * API 路径
 */
const API_PATHS = {
    INDEX_LIST: '/App/IndexList/indexList',
    PLAY_INFO: '/App/IndexPlay/playInfo',
    VURL_SHOW: '/App/Resource/Vurl/show',
    VURL_DETAIL: '/App/Resource/VurlDetail/showOne',
    FIND_MORE: '/App/Index/findMoreVod',
    SIGN_UP: '/App/Authentication/Device/signUp',
    SIGN_IN: '/App/Authentication/Device/signIn',
    REFRESH: '/App/Authentication/Authenticator/refresh'
};

/**
 * 缓存管理
 */
const cache = {
    data: new Map(),
    ttl: {
        category: 300000,
        detail: 600000,
        play: 300000,
        search: 60000
    },
    get: (key) => {
        const item = cache.data.get(key);
        if (!item) return null;
        if (Date.now() > item.expire) {
            cache.data.delete(key);
            return null;
        }
        return item.data;
    },
    set: (key, data, type = 'category') => {
        cache.data.set(key, {
            data,
            expire: Date.now() + cache.ttl[type]
        });
        if (cache.data.size > 200) cache.data.clear();
    }
};

/**
 * 日志工具
 */
const logInfo = (message, data = null) => {
    if (data) {
        OmniBox.log("info", `[瓜子APP] ${message}: ${JSON.stringify(data)}`);
    } else {
        OmniBox.log("info", `[瓜子APP] ${message}`);
    }
};

const logError = (message, error) => {
    OmniBox.log("error", `[瓜子APP] ${message}: ${error.message || error}`);
};

const logWarn = (message) => {
    OmniBox.log("warn", `[瓜子APP] ${message}`);
};

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    if (!value || typeof value !== "object") return JSON.stringify(value);
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(",")}}`;
}

function apiJsonStringify(value) {
    return JSON.stringify(value).replace(/[^\x00-\x7F]/g, (char) => {
        return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
    });
}

function md5Upper(value) {
    return crypto.createHash("md5").update(String(value)).digest("hex").toUpperCase();
}

function aesEncryptHex(text, key = AES_KEY, iv = AES_IV) {
    const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
    cipher.setAutoPadding(true);
    return Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]).toString("hex").toUpperCase();
}

function aesDecryptHex(hexText, key, iv) {
    const decipher = crypto.createDecipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
    decipher.setAutoPadding(true);
    return Buffer.concat([
        decipher.update(Buffer.from(String(hexText || ""), "hex")),
        decipher.final(),
    ]).toString("utf8");
}

function rsaEncrypt(data) {
    return crypto
        .publicEncrypt(
            { key: RSA_PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
            Buffer.from(String(data), "utf8")
        )
        .toString("base64");
}

function rsaDecrypt(encryptedText) {
    const encrypted = Buffer.from(String(encryptedText || ""), "base64");
    try {
        return crypto
            .privateDecrypt({ key: RSA_PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, encrypted)
            .toString("utf8");
    } catch (error) {
        if (!crypto.constants.RSA_NO_PADDING) throw error;
    }
    const raw = crypto.privateDecrypt({ key: RSA_PRIVATE_KEY, padding: crypto.constants.RSA_NO_PADDING }, encrypted);
    if (raw[0] !== 0x00 || raw[1] !== 0x02) throw new Error("响应密钥 RSA padding 不匹配");
    const split = raw.indexOf(0x00, 2);
    if (split < 10) throw new Error("响应密钥 RSA padding 无效");
    return raw.slice(split + 1).toString("utf8");
}

function loadAuth() {
    try {
        if (fs.existsSync(AUTH_FILE)) {
            const data = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
            state.token = String(data.token || "");
            state.tokenId = String(data.tokenId || data.token_id || "");
            state.deviceId = String(data.deviceId || data.device_id || "");
            state.deviceKey = String(data.deviceKey || data.device_key || "");
            state.registered = !!data.registered || !!state.token;
        }
    } catch {}

    if (state.deviceId && state.deviceKey) return;

    state.deviceId = String(864150060000000 + Math.floor(Math.random() * 10000));
    state.deviceKey = crypto.randomBytes(20).toString("hex").toUpperCase();
    state.token = "";
    state.tokenId = "";
    state.registered = false;
    saveAuth();
}

function saveAuth() {
    try {
        fs.writeFileSync(
            AUTH_FILE,
            JSON.stringify(
                {
                    token: state.token,
                    tokenId: state.tokenId,
                    deviceId: state.deviceId,
                    deviceKey: state.deviceKey,
                    registered: state.registered,
                },
                null,
                2
            )
        );
    } catch (e) {
        logWarn(`保存认证信息失败: ${e.message}`);
    }
}

function getHeaders() {
    return {
        "User-Agent": PLAY_UA,
        code: "GZ0369",
        deviceId: state.deviceId || "",
        lang: "zh_cn",
        "Cache-Control": "no-cache",
        "Content-Type": "application/x-www-form-urlencoded",
        Version: "2604028",
        PackageName: "com.ae06aebdbb.y286327f5a.ofe849883320260517",
        Ver: "3.0.3.2",
        "api-ver": "3.0.3.2",
    };
}

const client = axios.create({
    timeout: 22000,
    maxRedirects: 3,
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
    validateStatus: () => true,
});

async function findAvailableHost() {
    for (const host of API_HOSTS) {
        try {
            const res = await axios.head(host, {
                timeout: 3000,
                httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                validateStatus: () => true,
                headers: { "User-Agent": "Mozilla/5.0" },
            });
            if (res.status >= 200 && res.status < 500) {
                state.apiHost = host;
                state.hostReady = true;
                logInfo("选用 API 域名", { host });
                return host;
            }
        } catch {}
    }
    state.apiHost = API_HOSTS[0];
    state.hostReady = true;
    return state.apiHost;
}

async function ensureHost() {
    if (!state.hostReady) await findAvailableHost();
    return state.apiHost;
}

function applyAuth(result = {}) {
    const newToken = String(result.token || "");
    if (!newToken) throw new Error(`Token 获取失败: ${JSON.stringify(result)}`);
    state.token = newToken;
    const newTokenId = String(result.app_user_id || result.token_id || "");
    if (newTokenId) state.tokenId = newTokenId;
    saveAuth();
}

async function rawApiRequest(path, params = {}, retry = 0, options = {}) {
    const authPath = String(path).startsWith("/App/Authentication/");
    if (!authPath) await ensureToken();

    const host = await ensureHost();
    const requestParams = { ...(params || {}) };
    if (Object.prototype.hasOwnProperty.call(requestParams, "token")) requestParams.token = state.token;
    if (Object.prototype.hasOwnProperty.call(requestParams, "token_id")) requestParams.token_id = state.tokenId;

    const useCache = options.useCache === true && !authPath;
    const cacheKey = `${host}|${path}|${stableStringify(requestParams)}|${state.tokenId}`;
    if (useCache) {
        const cached = cache.get(cacheKey);
        if (cached) {
            logInfo("使用缓存数据", { path });
            return cached;
        }
    }

    const jsonParams = apiJsonStringify(requestParams);
    const requestKey = aesEncryptHex(jsonParams);
    const time = String(Math.floor(Date.now() / 1000));
    const keys = rsaEncrypt(JSON.stringify({ iv: AES_IV, key: AES_KEY }));
    const tokenForSign = state.token || "";
    const signStr =
        `token_id=,token=${tokenForSign},phone_type=1,request_key=${requestKey}` +
        `,app_id=1,time=${time},keys=${keys}*&zvdvdvddbfikkkumtmdwqppp?|4Y!s!2br`;
    const signature = md5Upper(signStr);

    const body = new URLSearchParams({
        token: tokenForSign,
        token_id: "",
        phone_type: "1",
        time,
        phone_model: "xiaomi-25031",
        keys,
        request_key: requestKey,
        signature,
        app_id: "1",
        ad_version: "1",
    }).toString();

    logInfo(`发送API请求`, { url: `${host}${path}`, retry });
    const res = await client.post(`${host}${path}`, body, { headers: getHeaders() });
    if (res.status < 200 || res.status >= 400) {
        throw new Error(`HTTP ${res.status} ${path}`);
    }

    const response = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    if (!response || typeof response !== "object") throw new Error(`空响应 ${path}`);

    if (response.code != null && Number(response.code) !== 200) {
        if (retry < 1 && !authPath) {
            state.tokenReady = false;
            await ensureToken(true);
            return rawApiRequest(path, params, retry + 1, options);
        }
        throw new Error(`请求失败: ${JSON.stringify(response)}`);
    }

    const encryptedData = response.data || {};
    if (!encryptedData.keys || !encryptedData.response_key) {
        throw new Error(`API 返回缺少加密数据: ${path}`);
    }
    const keyInfo = JSON.parse(rsaDecrypt(encryptedData.keys));
    const decrypted = aesDecryptHex(encryptedData.response_key, keyInfo.key, keyInfo.iv);
    const result = JSON.parse(decrypted);
    if (useCache) {
        const cacheType = options.cacheType || "category";
        cache.set(cacheKey, result, cacheType);
    }
    logInfo("API请求成功", { path });
    return result;
}

async function signUp() {
    const result = await rawApiRequest(API_PATHS.SIGN_UP, {
        new_key: state.deviceKey,
        old_key: DEVICE_OLD_KEY,
        phone_type: 1,
        code: "",
    });
    applyAuth(result);
    state.registered = true;
    saveAuth();
}

async function signIn() {
    const result = await rawApiRequest(API_PATHS.SIGN_IN, {
        new_key: state.deviceKey,
        old_key: DEVICE_OLD_KEY,
    });
    applyAuth(result);
}

async function ensureToken(force = false) {
    if (!force && state.tokenReady && state.token) return;
    loadAuth();
    if (!state.token) {
        if (state.registered) await signIn();
        else await signUp();
    }
    try {
        applyAuth(await rawApiRequest(API_PATHS.REFRESH, {}));
    } catch (error) {
        if (!state.registered) throw error;
        await signIn();
    }
    state.tokenReady = true;
}

/**
 * API 请求函数（兼容旧调用）
 */
const apiRequest = async (data, path, cacheType = "category", retries = 1) => {
    try {
        return await rawApiRequest(path, data, 0, {
            useCache: cacheType !== "none",
            cacheType: cacheType === "none" ? "category" : cacheType,
        });
    } catch (e) {
        if (retries > 0) {
            logWarn(`API请求失败，重试: ${e.message}`);
            try {
                return await rawApiRequest(path, data, 0, {
                    useCache: false,
                    cacheType: cacheType === "none" ? "category" : cacheType,
                });
            } catch (e2) {
                logError("API请求最终失败", e2);
                return null;
            }
        }
        logError("API请求最终失败", e);
        return null;
    }
};

/**
 * 获取分辨率分数（用于排序）
 */
const getResolutionScore = (res) => {
    const r = String(res || "").toLowerCase().replace("p", "");
    if (r === "8k") return 100;
    if (r === "4k" || r === "2160") return 90;
    if (r === "1440") return 80;
    if (r === "1080") return 70;
    if (r === "720") return 60;
    if (r === "超清") return 50;
    if (r === "高清") return 40;
    if (r === "标清") return 30;
    return 10;
};

function parseParamString(value) {
    const text = String(value || "").replace(/&amp;/g, "&").replace(/^\?/, "");
    const params = {};
    for (const [key, val] of new URLSearchParams(text)) {
        params[key === "vod_d_id" ? "vod_id" : key] = val;
    }
    return params;
}

/**
 * 弹幕工具函数
 */
const preprocessTitle = (title) => {
    if (!title) return "";
    return title
        .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
        .replace(/[hH]\\.?26[45]/g, " ")
        .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
        .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
};

const chineseToArabic = (cn) => {
    const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    if (!isNaN(cn)) return parseInt(cn, 10);
    if (cn.length === 1) return map[cn] || cn;
    if (cn.length === 2) {
        if (cn[0] === '十') return 10 + map[cn[1]];
        if (cn[1] === '十') return map[cn[0]] * 10;
    }
    if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
    return cn;
};

const extractEpisode = (title) => {
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
};

const buildFileNameForDanmu = (vodName, episodeTitle) => {
    if (!vodName) return "";
    if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') return vodName;

    const digits = extractEpisode(episodeTitle);
    if (digits) {
        const epNum = parseInt(digits, 10);
        if (epNum > 0) {
            if (epNum < 10) return `${vodName} S01E0${epNum}`;
            return `${vodName} S01E${epNum}`;
        }
    }
    return vodName;
};

const buildScrapedDanmuFileName = (scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) => {
    if (!scrapeData) {
        return buildFileNameForDanmu(fallbackVodName, fallbackEpisodeName);
    }

    if (scrapeType === 'movie') {
        return scrapeData.title || fallbackVodName;
    }

    const title = scrapeData.title || fallbackVodName;
    const seasonAirYear = scrapeData.seasonAirYear || '';
    const seasonNumber = mapping?.seasonNumber || 1;
    const episodeNumber = mapping?.episodeNumber || 1;
    return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
};

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
        if (!matchData.isMatched) return [];

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
    } catch (e) {
        logWarn(`弹幕匹配失败: ${e.message}`);
        return [];
    }
};

const encodeMeta = (obj) => {
    try {
        return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
    } catch {
        return '';
    }
};

const decodeMeta = (str) => {
    try {
        const raw = Buffer.from(str, 'base64').toString('utf8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
};

const extractVodIdForApi = (rawVideoId) => {
    const text = String(rawVideoId || '').trim();
    if (!text) return '';

    const decoded = decodeURIComponent(text);
    const pathMatch = decoded.match(/\/id\/(\d+)\.html/i);
    if (pathMatch?.[1]) return pathMatch[1];

    const firstPart = decoded.split('/')[0];
    if (/^\d+$/.test(firstPart)) return firstPart;

    const numMatch = decoded.match(/(\d+)/);
    return numMatch?.[1] || decoded;
};

/* ============================================================================
 * OmniBox 接口实现
 * ============================================================================ */

/**
 * 获取首页数据
 */
async function home(params) {
    try {
        logInfo('处理首页请求');

        const data = await apiRequest({
            area: '0',
            year: '0',
            pageSize: '100',
            sort: 'd_id',
            page: '1'
        }, API_PATHS.INDEX_LIST, 'category');

        let list = [];
        if (data?.list) {
            list = data.list.map(item => ({
                vod_id: `${item.vod_id}/${item.vod_continu || 0}`,
                vod_name: item.vod_name,
                vod_pic: item.vod_pic,
                vod_remarks: (item.vod_continu || 0) === 0 ? '电影' : `更新至${item.vod_continu}集`
            }));
        }

        return {
            class: CLASSES,
            filters: FILTERS,
            list
        };
    } catch (error) {
        logError('获取首页数据失败', error);
        return {
            class: [],
            filters: {},
            list: []
        };
    }
}

/**
 * 获取分类数据
 */
async function category(params) {
    try {
        const categoryId = params.categoryId;
        const page = params.page || 1;
        const filters = params.filters || {};

        if (!categoryId) {
            throw new Error("分类ID不能为空");
        }

        const area = filters.area || '0';
        const year = filters.year || '0';
        const sort = filters.sort || 'd_id';
        const tid = String(categoryId);

        logInfo('获取分类列表', { categoryId, page, area, year, sort });

        const data = await apiRequest({
            area: area,
            year: year,
            pageSize: "20",
            sort: sort,
            page: page.toString(),
            tid: tid,
            sub: SUB_MAP[tid] != null ? SUB_MAP[tid] : "0",
        }, API_PATHS.INDEX_LIST, 'category');

        if (!data || !data.list) {
            logWarn('分类列表数据为空');
            return { list: [], page: page, pagecount: 0 };
        }

        const totalPage = parseInt(data.totalPage || 0);

        const list = data.list.map(item => ({
            vod_id: `${item.vod_id}/${item.vod_continu || 0}`,
            vod_name: item.vod_name,
            vod_pic: item.vod_pic,
            vod_remarks: (item.vod_continu || 0) === 0 ? '电影' : `更新至${item.vod_continu}集`
        }));

        logInfo('分类列表获取成功', { count: list.length });

        return {
            list: list,
            page: parseInt(page),
            pagecount: totalPage === 0 ? 999 : totalPage
        };
    } catch (error) {
        logError('获取分类数据失败', error);
        return {
            page: 1,
            pagecount: 0,
            list: []
        };
    }
}

/**
 * 搜索视频
 */
async function search(params) {
    try {
        const keyword = params.keyword || params.wd || "";
        const page = params.page || 1;

        if (!keyword) {
            return {
                page: 1,
                pagecount: 0,
                list: []
            };
        }

        logInfo('执行搜索', { keyword, page });

        const data = await apiRequest({
            keywords: keyword,
            order_val: "1",
            page: page.toString()
        }, API_PATHS.FIND_MORE, 'search');

        if (!data || !data.list) {
            logWarn('搜索结果为空');
            return { list: [], page: page, pagecount: 0 };
        }

        const totalPage = parseInt(data.totalPage || 0);

        const filteredList = data.list
            .filter(item => item.vod_name && item.vod_name.toLowerCase().includes(keyword.toLowerCase()))
            .map(item => ({
                vod_id: `${item.vod_id}/${item.vod_continu || 0}`,
                vod_name: item.vod_name,
                vod_pic: item.vod_pic,
                vod_remarks: (item.vod_continu || 0) === 0 ? '电影' : `更新至${item.vod_continu}集`
            }));

        logInfo('搜索完成(已过滤)', { keyword, count: filteredList.length });

        return {
            list: filteredList,
            page: parseInt(page),
            pagecount: totalPage === 0 ? 1 : totalPage
        };
    } catch (error) {
        logError('搜索视频失败', error);
        return {
            page: 1,
            pagecount: 0,
            list: []
        };
    }
}

/**
 * 获取视频详情
 */
async function detail(params) {
    try {
        const videoId = params.videoId;

        if (!videoId) {
            throw new Error("视频ID不能为空");
        }

        logInfo('获取视频详情', { videoId });

        const ids = Array.isArray(videoId) ? videoId : [videoId];
        const results = [];

        await Promise.all(ids.map(async (idStr) => {
            try {
                const videoIdForScrape = String(idStr || '');
                const vodId = extractVodIdForApi(idStr);

                await ensureToken();

                const [detailData, playData] = await Promise.all([
                    apiRequest({
                        token_id: state.tokenId,
                        vod_id: vodId,
                        mobile_time: Math.floor(Date.now() / 1000).toString(),
                        token: state.token
                    }, API_PATHS.PLAY_INFO, 'detail'),
                    apiRequest({
                        vurl_cloud_id: "2",
                        vod_d_id: vodId
                    }, API_PATHS.VURL_SHOW, 'detail')
                ]);

                if (!detailData?.vodInfo) {
                    logWarn(`视频${vodId}详情为空`);
                    return;
                }

                const vod = detailData.vodInfo;

                const vodPlaySources = [];
                const scrapeCandidates = [];
                if (playData?.list) {
                    playData.list.forEach((item, index) => {
                        if (!item.play) return;

                        const resolutions = [];
                        const params = [];

                        for (const [key, val] of Object.entries(item.play)) {
                            if (val.param) {
                                resolutions.push(key);
                                params.push(val.param);
                            }
                        }

                        if (params.length > 0) {
                            resolutions.sort((a, b) => getResolutionScore(b) - getResolutionScore(a));
                            const playName = playData.list.length === 1
                                ? (vod.vod_name || '正片')
                                : (item.name || (index + 1).toString());
                            const playUrl = `${params[0]}||${resolutions.join('@')}`;

                            if (vodPlaySources.length === 0) {
                                vodPlaySources.push({
                                    name: '瓜子专线',
                                    episodes: []
                                });
                            }

                            const playIdForSource = `${playUrl}|||${encodeMeta({ v: vod.vod_name || '', e: playName, sid: `${videoIdForScrape}#${index}`, fid: `${videoIdForScrape}#${index}` })}`;

                            vodPlaySources[0].episodes.push({
                                name: playName,
                                playId: playIdForSource
                            });

                            scrapeCandidates.push({
                                fid: `${videoIdForScrape}#${index}`,
                                file_id: `${videoIdForScrape}#${index}`,
                                file_name: playName,
                                name: playName,
                                format_type: 'video'
                            });
                        }
                    });
                }

                let scrapeData = null;
                let videoMappings = [];
                if (scrapeCandidates.length > 0) {
                    try {
                        const scrapingResult = await OmniBox.processScraping(videoId, vod.vod_name || '', vod.vod_name || '', scrapeCandidates);
                        OmniBox.log('info', `[瓜子APP] 刮削处理完成,结果: ${JSON.stringify(scrapingResult || {}).substring(0, 200)}`);
                        const metadata = await OmniBox.getScrapeMetadata(videoId);
                        scrapeData = metadata?.scrapeData || null;
                        videoMappings = metadata?.videoMappings || [];
                        logInfo('刮削完成', { vodId, mappingCount: videoMappings.length, hasScrapeData: !!scrapeData });
                    } catch (e) {
                        logWarn(`刮削处理失败: ${e.message}`);
                    }
                }

                if (vodPlaySources.length > 0 && Array.isArray(vodPlaySources[0].episodes) && vodPlaySources[0].episodes.length > 0) {
                    vodPlaySources[0].episodes.forEach((ep) => {
                        const playIdRaw = ep.playId || '';
                        const metaRaw = playIdRaw.includes('|||') ? playIdRaw.split('|||')[1] : '';
                        const meta = decodeMeta(metaRaw || '');
                        const mapping = videoMappings.find((m) => m?.fileId === meta.fid);
                        if (mapping?.episodeName) {
                            const oldName = ep.name;
                            ep.name = mapping.episodeNumber + "." + mapping.episodeName;
                            if (oldName !== ep.name) {
                                OmniBox.log('info', `[瓜子APP] 应用刮削后源文件名: ${oldName} -> ${ep.name}`);
                            }
                        }
                    });

                    const hasEpisodeNumber = vodPlaySources[0].episodes.some((ep) => {
                        const playIdRaw = ep.playId || '';
                        const metaRaw = playIdRaw.includes('|||') ? playIdRaw.split('|||')[1] : '';
                        const meta = decodeMeta(metaRaw || '');
                        const mapping = videoMappings.find((m) => m?.fileId === meta.fid);
                        return mapping && mapping.episodeNumber !== undefined && mapping.episodeNumber !== null;
                    });

                    if (hasEpisodeNumber) {
                        vodPlaySources[0].episodes.sort((a, b) => {
                            const metaA = decodeMeta((a.playId || '').split('|||')[1] || '');
                            const metaB = decodeMeta((b.playId || '').split('|||')[1] || '');
                            const mapA = videoMappings.find((m) => m?.fileId === metaA.fid) || {};
                            const mapB = videoMappings.find((m) => m?.fileId === metaB.fid) || {};
                            const seasonA = mapA.seasonNumber || 0;
                            const seasonB = mapB.seasonNumber || 0;
                            if (seasonA !== seasonB) return seasonA - seasonB;
                            const epA = mapA.episodeNumber || 0;
                            const epB = mapB.episodeNumber || 0;
                            return epA - epB;
                        });
                    }
                }

                const video = {
                    vod_id: videoIdForScrape,
                    vod_name: scrapeData?.title || vod.vod_name,
                    vod_pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : vod.vod_pic,
                    vod_year: scrapeData?.releaseDate ? String(scrapeData.releaseDate).substring(0, 4) : vod.vod_year,
                    vod_area: vod.vod_area,
                    vod_actor: (scrapeData?.credits?.cast || []).slice(0, 5).map((c) => c?.name).filter(Boolean).join(',') || vod.vod_actor,
                    vod_director: (scrapeData?.credits?.crew || []).filter((c) => c?.job === 'Director' || c?.department === 'Directing').slice(0, 3).map((c) => c?.name).filter(Boolean).join(',') || '',
                    vod_content: (scrapeData?.overview || vod.vod_use_content || '').trim(),
                    vod_play_sources: vodPlaySources.length > 0 ? vodPlaySources : undefined
                };

                results.push(video);
            } catch (e) {
                logError(`获取视频${idStr}详情失败`, e);
            }
        }));

        logInfo('详情获取成功', { count: results.length });

        return { list: results };
    } catch (error) {
        logError('获取视频详情失败', error);
        return { list: [] };
    }
}

/**
 * 获取播放地址
 */
async function play(params) {
    try {
        let playId = params.playId;
        let vodName = '';
        let episodeName = '';
        let playMeta = {};

        if (!playId) {
            throw new Error("播放地址ID不能为空");
        }

        if (playId.includes('|||')) {
            const [mainPlayId, metaB64] = playId.split('|||');
            playId = mainPlayId;
            playMeta = decodeMeta(metaB64 || '');
            vodName = playMeta.v || '';
            episodeName = playMeta.e || '';
        }

        let scrapedDanmuFileName = '';
        try {
            const videoIdFromParam = params.vodId ? String(params.vodId) : '';
            const videoIdFromMeta = playMeta?.sid ? String(playMeta.sid).split('#')[0] : '';
            const videoId = videoIdFromParam || videoIdFromMeta;
            const sourceIdByVod = videoId;

            let metadata = null;
            if (sourceIdByVod) {
                metadata = await OmniBox.getScrapeMetadata(sourceIdByVod);
            }

            if (metadata && metadata.scrapeData) {
                const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === playMeta?.fid);
                scrapedDanmuFileName = buildScrapedDanmuFileName(metadata.scrapeData, metadata.scrapeType || '', mapping, vodName, episodeName);
                if (metadata.scrapeData.title) {
                    vodName = metadata.scrapeData.title;
                }
                if (mapping?.episodeName) {
                    episodeName = mapping.episodeName;
                }
            }
        } catch (e) {
            logWarn(`读取刮削元数据失败: ${e.message}`);
        }

        logInfo('获取播放地址', { playId: playId });

        const playHeader = {
            "User-Agent": PLAY_UA,
            Referer: PLAY_REFERER,
        };

        const parts = playId.split('||');
        let playResponse;
        if (parts.length < 2) {
            playResponse = {
                urls: [{ name: '播放', url: playId }],
                header: playHeader,
                parse: 0
            };
        } else {
            const paramStr = parts[0];
            const resolutions = parts[1].split('@');

            const requestParams = parseParamString(paramStr);

            if (resolutions.length > 0) {
                resolutions.sort((a, b) => getResolutionScore(b) - getResolutionScore(a));
                requestParams.resolution = resolutions[0];
            }

            const data = await apiRequest(requestParams, API_PATHS.VURL_DETAIL, 'none');

            const playUrl = data?.url || '';

            logInfo('播放地址获取成功', { url: playUrl });

            playResponse = {
                urls: [{ name: '播放', url: playUrl }],
                header: playHeader,
                parse: 0
            };
        }

        if (DANMU_API && vodName) {
            const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
            logInfo(`尝试匹配弹幕文件名: ${fileName}`);
            if (fileName) {
                const danmakuList = await matchDanmu(fileName);
                if (danmakuList.length > 0) {
                    playResponse.danmaku = danmakuList;
                    logInfo('弹幕已添加到播放响应');
                }
            }
        } else if (!DANMU_API) {
            logInfo('DANMU_API 未配置，跳过弹幕匹配');
        }

        return playResponse;
    } catch (error) {
        logError('获取播放地址失败', error);
        return {
            urls: [],
            parse: 0
        };
    }
}

/* ============================================================================
 * 导出模块
 * ============================================================================ */

module.exports = {
    home,
    category,
    search,
    detail,
    play
};

// 使用 OmniBox runner
const runner = require("spider_runner");
runner.run(module.exports);
