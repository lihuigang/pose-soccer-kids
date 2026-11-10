import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8099/?demo=1&autostart=demo"

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    logs = []
    page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    page.goto(URL)
    page.wait_for_timeout(11000)
    state = page.evaluate("window.__app ? window.__app.snapshot() : null")
    print("STATE", state)
    page.screenshot(path="/tmp/shot1.png")
    print("\n".join(logs[:40]))
    browser.close()
