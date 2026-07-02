#!/usr/bin/env python3
"""Submit every sitemap URL to IndexNow (Bing/DuckDuckGo/Yandex).

Env: BASE (site base URL), KEY (IndexNow key, served as /<KEY>.txt).
Never exits non-zero — indexing must not fail a deploy.
"""
import json
import os
import re
import urllib.request

def main() -> None:
    base = os.environ["BASE"].rstrip("/")
    key = os.environ["KEY"]
    host = base.split("//")[1].split("/")[0]
    with urllib.request.urlopen(f"{base}/sitemap.xml", timeout=30) as r:
        sitemap = r.read().decode()
    urls = re.findall(r"<loc>([^<]+)</loc>", sitemap)[:800]
    body = json.dumps(
        {
            "host": host,
            "key": key,
            "keyLocation": f"{base}/{key}.txt",
            "urlList": urls,
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.indexnow.org/indexnow",
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        print("IndexNow:", r.status, len(urls), "urls submitted")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 — best effort by design
        print("IndexNow ping failed (non-fatal):", e)
