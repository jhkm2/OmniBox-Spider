# -*- coding: utf-8 -*-
# @name 808影视
# @author OmniBox-Spider
# @description 影视站：https://www.ztzssz.com，支持首页、分类筛选、搜索、详情与直链播放
# @version 1.0.0
# @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/808影视.py
# @dependencies lxml

import base64
import json
import os
import re
from datetime import datetime
from urllib.parse import quote, unquote, urljoin, urlparse

from lxml import etree
from spider_runner import OmniBox, run


BASE_URL = os.environ.get("YINGSHI808_HOST", "https://www.ztzssz.com").rstrip("/")
UA = os.environ.get(
    "YINGSHI808_UA",
    "Mozilla/5.0 (Linux; Android 12; SM-S908U) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
)

HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": f"{BASE_URL}/",
}

CLASS_LIST = [
    {"type_id": "1", "type_name": "电影"},
    {"type_id": "2", "type_name": "电视剧"},
    {"type_id": "3", "type_name": "综艺"},
    {"type_id": "4", "type_name": "动漫"},
    {"type_id": "20", "type_name": "短剧"},
    {"type_id": "35", "type_name": "动画片"},
    {"type_id": "36", "type_name": "4K电影"},
    {"type_id": "37", "type_name": "Netflix作品"},
]
CLASS_IDS = {item["type_id"] for item in CLASS_LIST}

COMMON_GENRES = [
    "动作", "喜剧", "爱情", "科幻", "恐怖", "剧情", "战争", "警匪", "犯罪", "动画",
    "奇幻", "武侠", "冒险", "枪战", "悬疑", "惊悚", "经典", "青春", "文艺", "微电影",
    "古装", "历史", "运动", "农村", "儿童", "网络电影",
]
SERIES_GENRES = [
    "古装", "战争", "青春偶像", "喜剧", "家庭", "犯罪", "动作", "奇幻", "剧情", "历史",
    "经典", "乡村", "情景", "商战", "网剧", "其他",
]
AREAS = [
    "大陆", "香港", "台湾", "美国", "法国", "英国", "日本", "韩国", "德国", "泰国",
    "印度", "意大利", "西班牙", "加拿大", "其他",
]
LANGUAGES = ["国语", "英语", "粤语", "闽南语", "韩语", "日语", "法语", "德语", "其它"]


def make_options(values, extra=None):
    options = [{"name": "全部", "value": ""}]
    options.extend({"name": value, "value": value} for value in values)
    if extra:
        options.extend(extra)
    return options


def make_filters(category_id):
    genres = SERIES_GENRES if category_id in {"2", "3", "4", "20"} else COMMON_GENRES
    current_year = datetime.now().year
    return [
        {"key": "type", "name": "类型", "value": make_options(genres)},
        {"key": "area", "name": "地区", "value": make_options(AREAS)},
        {"key": "lang", "name": "语言", "value": make_options(LANGUAGES)},
        {
            "key": "year",
            "name": "年份",
            "value": make_options([str(year) for year in range(current_year, 1999, -1)]),
        },
        {
            "key": "letter",
            "name": "字母",
            "value": make_options(list("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), [{"name": "其他", "value": "0"}]),
        },
    ]


FILTERS = {category_id: make_filters(category_id) for category_id in CLASS_IDS}


def clean_text(value):
    return re.sub(r"\s+", " ", str(value or "").replace("\xa0", " ")).strip()


def normalize_page(value):
    try:
        return max(1, int(value or 1))
    except (TypeError, ValueError):
        return 1


def normalize_filters(value):
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def abs_url(value):
    raw = clean_text(value)
    return urljoin(f"{BASE_URL}/", raw) if raw else ""


def is_site_url(value):
    expected = urlparse(BASE_URL)
    candidate = urlparse(value)
    return (
        candidate.scheme in {"http", "https"}
        and candidate.scheme == expected.scheme
        and candidate.netloc.lower() == expected.netloc.lower()
    )


def parse_html(text):
    try:
        return etree.HTML(text or "")
    except (TypeError, ValueError, etree.ParserError):
        return None


def node_text(node):
    return clean_text(" ".join(node.itertext())) if node is not None else ""


def first_xpath(node, expressions):
    for expression in expressions:
        values = node.xpath(expression)
        if not values:
            continue
        value = values[0]
        if isinstance(value, etree._Element):
            value = node_text(value)
        value = clean_text(value)
        if value:
            return value
    return ""


async def log(level, message):
    try:
        await OmniBox.log(level, f"[808影视] {message}")
    except Exception:
        pass


async def request_text(url, referer=None):
    headers = dict(HEADERS)
    headers["Referer"] = referer or f"{BASE_URL}/"
    response = await OmniBox.request(
        url,
        {
            "method": "GET",
            "headers": headers,
            "timeout": 30000,
        },
    )
    status = int(response.get("statusCode") or 0)
    body = response.get("body", "")
    text = body.decode("utf-8", "ignore") if isinstance(body, (bytes, bytearray)) else str(body or "")
    if not 200 <= status < 300:
        raise RuntimeError(f"HTTP {status or 'unknown'} @ {url}")
    return text


def parse_video_list(text):
    root = parse_html(text)
    if root is None:
        return []

    items = root.xpath(
        '//div[contains(concat(" ", normalize-space(@class), " "), " ewave-vodlist__thumb ")]'
        ' | //a[contains(concat(" ", normalize-space(@class), " "), " ewave-vodlist__thumb ")]'
    )
    videos = []
    seen = set()
    for item in items:
        href = clean_text(item.get("href")) or first_xpath(
            item,
            ['.//a[contains(@href, "/voddetail/")]/@href'],
        )
        match = re.search(r"/voddetail/(\d+)\.html", href)
        if not match or match.group(1) in seen:
            continue

        vod_id = match.group(1)
        title = clean_text(item.get("title") or item.get("alt")) or first_xpath(
            item,
            [
                './/img/@alt',
                './/a[contains(@href, "/voddetail/")]/@title',
                './/a[contains(@href, "/voddetail/")]',
            ],
        )
        if not title:
            continue

        poster = clean_text(
            item.get("data-original") or item.get("data-src") or item.get("src")
        ) or first_xpath(item, ['.//img/@data-original', './/img/@data-src', './/img/@src'])
        remarks = first_xpath(
            item,
            [
                './/*[contains(concat(" ", normalize-space(@class), " "), " pic-text ")]',
                './/*[contains(concat(" ", normalize-space(@class), " "), " pic-tag ")]',
            ],
        )
        seen.add(vod_id)
        videos.append(
            {
                "vod_id": vod_id,
                "vod_name": title,
                "vod_pic": abs_url(poster),
                "vod_remarks": remarks,
            }
        )
    return videos


def parse_page_count(text):
    root = parse_html(text)
    if root is None:
        return 1

    markers = root.xpath(
        '//*[contains(concat(" ", normalize-space(@class), " "), " num ")]'
    )
    for marker in markers:
        match = re.search(r"\d+\s*/\s*(\d+)", node_text(marker))
        if match:
            return max(1, int(match.group(1)))

    pagecount = 1
    for href in root.xpath('//a[@href]/@href'):
        type_match = re.search(r"/vodtype/\d+-(\d+)\.html", href)
        search_match = re.search(r"/vodsearch/.+?----------(\d+)---\.html", href)
        if type_match or search_match:
            pagecount = max(pagecount, int((type_match or search_match).group(1)))
            continue
        show_match = re.search(r"/vodshow/([^/?]+)\.html", href)
        if show_match:
            segments = show_match.group(1).split("-")
            if len(segments) > 8 and segments[8].isdigit():
                pagecount = max(pagecount, int(segments[8]))
    return pagecount


def build_category_url(category_id, page, filters):
    category_id = str(category_id)
    page = normalize_page(page)
    filters = normalize_filters(filters)
    values = {
        key: clean_text(filters.get(key))
        for key in ("type", "area", "lang", "year", "letter")
    }
    if not any(values.values()):
        suffix = f"-{page}" if page > 1 else ""
        return f"{BASE_URL}/vodtype/{category_id}{suffix}.html"

    segments = [
        category_id,
        values["area"],
        "",
        values["type"],
        values["lang"],
        values["letter"],
        "",
        "",
        str(page) if page > 1 else "",
        "",
        "",
        values["year"],
    ]
    slug = "-".join(quote(segment, safe="") for segment in segments)
    return f"{BASE_URL}/vodshow/{slug}.html"


def parse_labeled_fields(root):
    fields = {}
    label_pattern = re.compile(r"(类型|地区|年份|主演|导演|更新)\s*[：:]")
    nodes = root.xpath(
        '//p[contains(concat(" ", normalize-space(@class), " "), " data ")]'
    )
    for node in nodes:
        text = node_text(node)
        matches = list(label_pattern.finditer(text))
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            value = clean_text(text[match.end():end])
            if value:
                fields[match.group(1)] = value
    return fields


def parse_play_sources(root):
    source_names = {}
    tabs = root.xpath(
        '//ul[contains(concat(" ", normalize-space(@class), " "), " nav-tabs ")]//a[@href]'
    )
    for tab in tabs:
        match = re.search(r"#playlist([\w-]+)", clean_text(tab.get("href")))
        if match:
            source_names[match.group(1)] = node_text(tab)

    sources = []
    panes = root.xpath(
        '//div[contains(concat(" ", normalize-space(@class), " "), " tab-pane ") and starts-with(@id, "playlist")]'
    )
    for pane in panes:
        match = re.search(r"playlist([\w-]+)", clean_text(pane.get("id")))
        if not match:
            continue
        source_id = match.group(1)
        episodes = []
        seen = set()
        for anchor in pane.xpath('.//a[contains(@href, "/vodplay/")]'):
            href = clean_text(anchor.get("href"))
            play_match = re.search(r"/vodplay/(\d+)-([^/.-]+)-(\d+)\.html", href)
            if not play_match:
                continue
            episode_number = int(play_match.group(3))
            play_id = abs_url(href)
            if play_id in seen:
                continue
            seen.add(play_id)
            episodes.append(
                (
                    episode_number,
                    {
                        "name": node_text(anchor) or f"第{episode_number}集",
                        "playId": play_id,
                    },
                )
            )
        episodes.sort(key=lambda item: item[0])
        if episodes:
            sources.append(
                {
                    "name": source_names.get(source_id) or f"线路{len(sources) + 1}",
                    "episodes": [item for _, item in episodes],
                }
            )

    if sources:
        return sources

    grouped = {}
    for anchor in root.xpath('//a[contains(@href, "/vodplay/")]'):
        href = clean_text(anchor.get("href"))
        match = re.search(r"/vodplay/(\d+)-([^/.-]+)-(\d+)\.html", href)
        if not match:
            continue
        source_id = match.group(2)
        episode_number = int(match.group(3))
        grouped.setdefault(source_id, {})[episode_number] = {
            "name": node_text(anchor) or f"第{episode_number}集",
            "playId": abs_url(href),
        }
    for source_id, episodes in grouped.items():
        sources.append(
            {
                "name": source_names.get(source_id) or f"线路{len(sources) + 1}",
                "episodes": [episodes[number] for number in sorted(episodes)],
            }
        )
    return sources


def extract_description(root):
    nodes = root.xpath('//*[@id="desc"]')
    if not nodes:
        nodes = root.xpath(
            '//p[contains(concat(" ", normalize-space(@class), " "), " desc ")]'
        )
    content = node_text(nodes[0]) if nodes else first_xpath(
        root,
        ['//meta[@name="description"]/@content', '//meta[@property="og:description"]/@content'],
    )
    content = re.sub(r"^(?:简介|剧情介绍)\s*[：:]?\s*", "", content)
    return re.sub(r"\s*详情\s*$", "", content).strip()


def build_legacy_play_fields(sources):
    from_names = []
    url_groups = []
    for source in sources:
        from_names.append(clean_text(source.get("name")) or "默认")
        episodes = source.get("episodes") or []
        url_groups.append(
            "#".join(
                f"{clean_text(episode.get('name')) or '播放'}${clean_text(episode.get('playId'))}"
                for episode in episodes
                if clean_text(episode.get("playId"))
            )
        )
    return "|".join(from_names), "|".join(url_groups)


def parse_detail_html(text, vod_id):
    root = parse_html(text)
    if root is None:
        return {}

    title = first_xpath(
        root,
        [
            '//h1[contains(concat(" ", normalize-space(@class), " "), " title ")]/span[not(contains(@class, "score"))]',
            '//h1[contains(concat(" ", normalize-space(@class), " "), " title ")]',
            '//h1',
            '//meta[@property="og:title"]/@content',
        ],
    )
    poster = first_xpath(
        root,
        [
            '//div[contains(concat(" ", normalize-space(@class), " "), " ewave-content__thumb ")]//img/@data-original',
            '//div[contains(concat(" ", normalize-space(@class), " "), " ewave-content__thumb ")]//img/@data-src',
            '//div[contains(concat(" ", normalize-space(@class), " "), " ewave-content__thumb ")]//img/@src',
            '//meta[@property="og:image"]/@content',
        ],
    )
    remarks = first_xpath(
        root,
        [
            '//div[contains(concat(" ", normalize-space(@class), " "), " ewave-content__thumb ")]'
            '//*[contains(concat(" ", normalize-space(@class), " "), " pic-text ")]',
        ],
    )
    fields = parse_labeled_fields(root)
    if not remarks:
        remarks = fields.get("更新", "")
    year_value = fields.get("年份", "")
    year_match = re.search(r"\d{4}", year_value)
    sources = parse_play_sources(root)
    play_from, play_url = build_legacy_play_fields(sources)

    return {
        "vod_id": str(vod_id),
        "vod_name": title,
        "vod_pic": abs_url(poster),
        "type_name": fields.get("类型", ""),
        "vod_year": year_match.group(0) if year_match else year_value,
        "vod_area": fields.get("地区", ""),
        "vod_remarks": remarks,
        "vod_actor": fields.get("主演", ""),
        "vod_director": fields.get("导演", ""),
        "vod_content": extract_description(root),
        "vod_play_sources": sources,
        "vod_play_from": play_from,
        "vod_play_url": play_url,
    }


def extract_video_id(value):
    if isinstance(value, (list, tuple)):
        value = value[0] if value else ""
    raw = clean_text(value)
    match = re.search(r"(?:/voddetail/)?(\d{1,12})(?:\.html)?$", raw)
    return match.group(1) if match else ""


def extract_player_url(text):
    match = re.search(r"(?:var\s+)?player_aaaa\s*=\s*", text or "", re.I)
    if not match:
        return ""
    try:
        payload, _ = json.JSONDecoder().raw_decode((text or "")[match.end():].lstrip())
    except (TypeError, ValueError, json.JSONDecodeError):
        return ""
    if not isinstance(payload, dict):
        return ""

    raw_url = clean_text(payload.get("url"))
    try:
        encrypt = int(payload.get("encrypt") or 0)
    except (TypeError, ValueError):
        encrypt = 0
    try:
        if encrypt == 1:
            raw_url = unquote(raw_url)
        elif encrypt == 2:
            padding = "=" * (-len(raw_url) % 4)
            raw_url = unquote(base64.b64decode(raw_url + padding).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return ""
    if raw_url.startswith(("/", "//")):
        return abs_url(raw_url)
    return raw_url


def is_direct_media(url):
    return bool(re.search(r"\.(?:m3u8|mp4|mkv|flv|mpd)(?:[?#]|$)", url or "", re.I))


def build_play_result(url, name, parse, header=None):
    headers = header or {}
    return {
        "parse": int(parse),
        "playUrl": "",
        "url": url,
        "urls": [{"name": name or "播放", "url": url}] if url else [],
        "header": headers,
        "headers": headers,
    }


async def home(params=None, context=None):
    try:
        text = await request_text(f"{BASE_URL}/")
        videos = parse_video_list(text)[:60]
        await log("info", f"home count={len(videos)}")
        return {"class": CLASS_LIST, "filters": FILTERS, "list": videos}
    except Exception as error:
        await log("error", f"home 失败: {error}")
        return {"class": CLASS_LIST, "filters": FILTERS, "list": []}


async def category(params, context=None):
    page = normalize_page((params or {}).get("page"))
    try:
        category_id = clean_text(
            (params or {}).get("categoryId") or (params or {}).get("type_id") or "1"
        )
        if category_id not in CLASS_IDS:
            raise ValueError("无效分类")
        filters = normalize_filters(
            (params or {}).get("filters")
            or (params or {}).get("extend")
            or (params or {}).get("ext")
        )
        url = build_category_url(category_id, page, filters)
        text = await request_text(url)
        videos = parse_video_list(text)
        pagecount = parse_page_count(text)
        limit = len(videos) or 20
        await log("info", f"category id={category_id} page={page} count={len(videos)}")
        return {
            "page": page,
            "pagecount": pagecount,
            "limit": limit,
            "total": pagecount * limit if videos else 0,
            "list": videos,
        }
    except Exception as error:
        await log("error", f"category 失败: {error}")
        return {"page": page, "pagecount": 0, "limit": 0, "total": 0, "list": []}


async def detail(params, context=None):
    try:
        vod_id = extract_video_id(
            (params or {}).get("videoId")
            or (params or {}).get("vod_id")
            or (params or {}).get("id")
        )
        if not vod_id:
            return {"list": []}
        text = await request_text(f"{BASE_URL}/voddetail/{vod_id}.html")
        item = parse_detail_html(text, vod_id)
        if not item or not item.get("vod_name"):
            return {"list": []}
        await log(
            "info",
            f"detail id={vod_id} sources={len(item.get('vod_play_sources') or [])}",
        )
        return {"list": [item]}
    except Exception as error:
        await log("error", f"detail 失败: {error}")
        return {"list": []}


async def ajax_search_fallback(keyword):
    url = f"{BASE_URL}/index.php/ajax/suggest?mid=1&wd={quote(keyword, safe='')}"
    text = await request_text(url)
    data = json.loads(text or "{}")
    videos = []
    for item in data.get("list") or []:
        vod_id = clean_text(item.get("id"))
        name = clean_text(item.get("name"))
        if vod_id and name:
            videos.append(
                {
                    "vod_id": vod_id,
                    "vod_name": name,
                    "vod_pic": abs_url(item.get("pic")),
                    "vod_remarks": clean_text(item.get("note")),
                }
            )
    return videos


async def search(params, context=None):
    page = normalize_page((params or {}).get("page"))
    try:
        keyword = clean_text(
            (params or {}).get("keyword")
            or (params or {}).get("wd")
            or (params or {}).get("key")
        )
        if not keyword:
            return {"page": page, "pagecount": 0, "limit": 0, "total": 0, "list": []}
        encoded = quote(keyword, safe="")
        if page == 1:
            url = f"{BASE_URL}/vodsearch/{encoded}-------------.html"
        else:
            url = f"{BASE_URL}/vodsearch/{encoded}----------{page}---.html"
        text = await request_text(url)
        blocked = any(
            marker in text for marker in ("验证码", "人机验证", "安全验证", "just_a_test")
        )
        videos = [] if blocked else parse_video_list(text)
        pagecount = parse_page_count(text) if videos else page
        if not videos and page == 1:
            videos = await ajax_search_fallback(keyword)
            pagecount = 1
        limit = len(videos) or 20
        await log("info", f"search page={page} count={len(videos)}")
        return {
            "page": page,
            "pagecount": pagecount,
            "limit": limit,
            "total": pagecount * limit if videos else 0,
            "list": videos,
        }
    except Exception as error:
        await log("error", f"search 失败: {error}")
        return {"page": page, "pagecount": 0, "limit": 0, "total": 0, "list": []}


async def play(params, context=None):
    try:
        play_id = clean_text(
            (params or {}).get("playId")
            or (params or {}).get("id")
            or (params or {}).get("url")
        )
        flag = clean_text((params or {}).get("flag")) or "播放"
        if not play_id:
            return build_play_result("", flag, 1)
        if is_direct_media(play_id):
            return build_play_result(play_id, flag, 0, {"User-Agent": UA})

        play_page = abs_url(play_id)
        if not is_site_url(play_page):
            raise ValueError("播放页不属于 808影视站点")
        text = await request_text(play_page, referer=f"{BASE_URL}/")
        stream_url = extract_player_url(text)
        headers = {"User-Agent": UA, "Referer": f"{BASE_URL}/"}
        if not stream_url:
            await log("warn", f"play 未提取直链，回退嗅探: {play_page}")
            return build_play_result(play_page, flag, 1, headers)

        parse_mode = 0 if is_direct_media(stream_url) else 1
        await log("info", f"play parse={parse_mode}")
        return build_play_result(stream_url, flag, parse_mode, headers)
    except Exception as error:
        await log("error", f"play 失败: {error}")
        return build_play_result("", clean_text((params or {}).get("flag")) or "播放", 1)


if __name__ == "__main__":
    run(
        {
            "home": home,
            "category": category,
            "detail": detail,
            "search": search,
            "play": play,
        }
    )
