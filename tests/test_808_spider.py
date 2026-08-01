import asyncio
import base64
import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from urllib.parse import quote, unquote


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "影视" / "采集" / "808影视.py"


class FakeOmniBox:
    responses = {}
    requests = []
    logs = []

    @classmethod
    async def request(cls, url, options):
        cls.requests.append((url, options))
        response = cls.responses.get(url)
        if response is None:
            raise AssertionError(f"Unexpected request: {url}")
        return response

    @classmethod
    async def log(cls, level, message):
        cls.logs.append((level, message))


runner = types.ModuleType("spider_runner")
runner.OmniBox = FakeOmniBox
runner.run = lambda handlers: handlers
sys.modules["spider_runner"] = runner

spec = importlib.util.spec_from_file_location("omnibox_808_spider", SOURCE)
spider = importlib.util.module_from_spec(spec)
spec.loader.exec_module(spider)


class Spider808Tests(unittest.TestCase):
    def setUp(self):
        FakeOmniBox.responses = {}
        FakeOmniBox.requests = []
        FakeOmniBox.logs = []

    def test_parse_video_list_uses_thumb_wrapper_and_deduplicates(self):
        html = """
        <div class="ewave-vodlist__thumb lazyload" title="测试影片"
             data-original="/poster.jpg">
          <span class="pic-text">更新至2集</span>
          <a class="thumb-link" href="/voddetail/42.html"></a>
        </div>
        <div class="ewave-vodlist__thumb" title="重复影片">
          <a href="/voddetail/42.html"></a>
        </div>
        """

        self.assertEqual(
            spider.parse_video_list(html),
            [
                {
                    "vod_id": "42",
                    "vod_name": "测试影片",
                    "vod_pic": f"{spider.BASE_URL}/poster.jpg",
                    "vod_remarks": "更新至2集",
                }
            ],
        )

    def test_build_category_url_preserves_maccms_segment_order(self):
        url = spider.build_category_url(
            "1",
            2,
            {
                "area": "大陆",
                "type": "喜剧",
                "lang": "国语",
                "letter": "A",
                "year": "2025",
            },
        )

        self.assertEqual(
            unquote(url),
            f"{spider.BASE_URL}/vodshow/1-大陆--喜剧-国语-A---2---2025.html",
        )
        self.assertEqual(spider.build_category_url("1", 1, {}), f"{spider.BASE_URL}/vodtype/1.html")
        self.assertEqual(spider.build_category_url("1", 3, {}), f"{spider.BASE_URL}/vodtype/1-3.html")

    def test_parse_detail_extracts_metadata_and_sorts_episodes(self):
        html = """
        <h1 class="title"><span>示例剧</span><span class="score">9.0</span></h1>
        <div class="ewave-content__thumb">
          <div class="ewave-vodlist__thumb">
            <img data-original="/cover.jpg">
            <span class="pic-text">更新至2集</span>
          </div>
        </div>
        <p class="data"><span class="text-muted">类型：</span>国产剧
          <span class="text-muted">地区：</span>中国大陆
          <span class="text-muted">年份：</span>2026</p>
        <p class="data"><span class="text-muted">主演：</span>演员甲 演员乙</p>
        <p class="data"><span class="text-muted">导演：</span>导演甲</p>
        <div id="desc"><p>这是完整简介。</p></div>
        <ul class="nav-tabs"><li><a href="#playlist1">云播资源</a></li></ul>
        <div class="tab-pane" id="playlist1"><ul>
          <li><a href="/vodplay/42-1-2.html">第02集</a></li>
          <li><a href="/vodplay/42-1-1.html">第01集</a></li>
        </ul></div>
        """

        item = spider.parse_detail_html(html, "42")

        self.assertEqual(item["vod_name"], "示例剧")
        self.assertEqual(item["vod_pic"], f"{spider.BASE_URL}/cover.jpg")
        self.assertEqual(item["type_name"], "国产剧")
        self.assertEqual(item["vod_area"], "中国大陆")
        self.assertEqual(item["vod_year"], "2026")
        self.assertEqual(item["vod_actor"], "演员甲 演员乙")
        self.assertEqual(item["vod_director"], "导演甲")
        self.assertEqual(item["vod_content"], "这是完整简介。")
        self.assertEqual(item["vod_remarks"], "更新至2集")
        self.assertEqual(item["vod_play_sources"][0]["name"], "云播资源")
        self.assertEqual(
            item["vod_play_sources"][0]["episodes"],
            [
                {"name": "第01集", "playId": f"{spider.BASE_URL}/vodplay/42-1-1.html"},
                {"name": "第02集", "playId": f"{spider.BASE_URL}/vodplay/42-1-2.html"},
            ],
        )

    def test_parse_page_count_reads_current_over_total_marker(self):
        self.assertEqual(spider.parse_page_count('<span class="num">2/1217</span>'), 1217)

    def test_extract_player_url_decodes_maccms_encrypt_modes(self):
        target = "https://cdn.example/video/index.m3u8?token=abc"
        encoded = quote(target, safe="")
        base64_encoded = base64.b64encode(encoded.encode("utf-8")).decode("ascii")

        self.assertEqual(
            spider.extract_player_url(f'<script>var player_aaaa = {json.dumps({"url": target, "encrypt": 0})};</script>'),
            target,
        )
        self.assertEqual(
            spider.extract_player_url(f'<script>player_aaaa = {json.dumps({"url": encoded, "encrypt": 1})};</script>'),
            target,
        )
        self.assertEqual(
            spider.extract_player_url(f'<script>player_aaaa = {json.dumps({"url": base64_encoded, "encrypt": 2})};</script>'),
            target,
        )

    def test_search_uses_paginated_html_route(self):
        url = f"{spider.BASE_URL}/vodsearch/{quote('哪吒', safe='')}----------2---.html"
        FakeOmniBox.responses[url] = {
            "statusCode": 200,
            "body": """
                <div class="ewave-vodlist__thumb" title="哪吒续集" data-original="/nezha.jpg">
                  <a href="/voddetail/99.html"></a>
                </div>
                <span class="num">2/3</span>
            """,
        }

        result = asyncio.run(spider.search({"keyword": "哪吒", "page": 2}, {}))

        self.assertEqual(FakeOmniBox.requests[0][0], url)
        self.assertEqual(result["page"], 2)
        self.assertEqual(result["pagecount"], 3)
        self.assertEqual(result["list"][0]["vod_id"], "99")

    def test_play_returns_direct_stream_from_player_payload(self):
        play_page = f"{spider.BASE_URL}/vodplay/42-1-1.html"
        stream_url = "https://cdn.example/video/index.m3u8"
        FakeOmniBox.responses[play_page] = {
            "statusCode": 200,
            "body": f'<script>var player_aaaa = {json.dumps({"url": stream_url, "encrypt": 0})};</script>',
        }

        result = asyncio.run(spider.play({"playId": play_page, "flag": "云播资源"}, {}))

        self.assertEqual(result["parse"], 0)
        self.assertEqual(result["url"], stream_url)
        self.assertEqual(result["urls"], [{"name": "云播资源", "url": stream_url}])
        self.assertEqual(result["header"]["Referer"], f"{spider.BASE_URL}/")

    def test_play_rejects_off_origin_page_without_requesting_it(self):
        result = asyncio.run(spider.play({"playId": "http://127.0.0.1/private"}, {}))

        self.assertEqual(FakeOmniBox.requests, [])
        self.assertEqual(result["url"], "")
        self.assertEqual(result["urls"], [])


if __name__ == "__main__":
    unittest.main()
