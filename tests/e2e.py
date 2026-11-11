"""End-to-end checks for 小小射手, driven by Playwright + Chromium.

Run (needs `pip install playwright` and the local server on 8099):
    python3 scripts/serve.mjs --port=8099 &   # or npm start
    python3 tests/e2e.py
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8099")
SHOTS = os.path.join(os.path.dirname(__file__), "..", "docs", "screenshots")
CAMERA_ARGS = [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--use-file-for-fake-video-capture=/tmp/fakecam.y4m",
    "--autoplay-policy=no-user-gesture-required",
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
]
GL_ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"]

failures = []


def check(name, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {name} {detail}")
    if not condition:
        failures.append(name)


def wait_for(page, expr, timeout=30.0, interval=0.25):
    end = time.time() + timeout
    while time.time() < end:
        value = page.evaluate(expr)
        if value:
            return value
        page.wait_for_timeout(interval * 1000)
    return None


def new_page(browser, viewport=(1280, 720), permissions=None):
    ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]}, permissions=permissions or [])
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.on(
        "console",
        lambda m: page.errors.append(f"[console.{m.type}] {m.text}")
        if m.type == "error"
        else None,
    )
    return page


def shot(page, name):
    os.makedirs(SHOTS, exist_ok=True)
    page.screenshot(path=os.path.join(SHOTS, name))


def test_home(browser):
    page = new_page(browser)
    page.goto(f"{BASE}/")
    page.wait_for_timeout(1500)
    check("home: start card visible", page.is_visible("#start"), "")
    check("home: canvases painted", page.evaluate("document.getElementById('stage').width > 0 && document.getElementById('stage3d').width > 0"))
    check("home: 3D is default", page.evaluate("window.__app.settings.avatar") == "3d")
    check("home: side view is default", page.evaluate("window.__app.game.layout.sideView") is True)
    check("home: WebGL2 scene ready", page.evaluate("window.__app.renderer.scene3d.renderer.getContext() instanceof WebGL2RenderingContext"))
    check("home: goal has an angled view", page.evaluate("Math.abs(window.__app.renderer.scene3d.goal.rotation.y) > 0.2"))
    shot(page, "01-home.png")
    page.close()


def test_demo(browser):
    page = new_page(browser)
    page.goto(f"{BASE}/?demo=1")
    playing = wait_for(page, "window.__app && window.__app.state.mode === 'playing'", 25)
    check("demo: reaches playing", bool(playing))
    tracked = wait_for(page, "window.__app.renderer.scene3d.player.root.visible && window.__app.renderer.scene3d.stats?.calls > 0")
    check("demo: 3D player rendered", bool(tracked))
    check(
        "demo: ball is between person and goal",
        page.evaluate("window.__app.game.ball.x > window.__app.game.input.bodyX && window.__app.game.ball.x < window.__app.game.layout.goal.cx"),
    )

    scored = wait_for(page, "window.__app && window.__app.snapshot().goals > 0", 25)
    snap = page.evaluate("window.__app.snapshot()")
    check("demo: foot swing scores a goal", bool(scored), str(snap))
    check("demo: person tracked", snap.get("visible") is True)

    page.wait_for_timeout(120)
    shot(page, "02-demo-goal.png")

    page.evaluate("window.__app.forceKick(0.55)")
    page.wait_for_timeout(120)
    check("demo: forced kick records kicking foot", page.evaluate("window.__app.game.ball.lastKickFoot") == "R")
    alignment = page.evaluate(
        """() => {
            const a = window.__app, b = a.game.ball, r = a.renderer.scene3d;
            const t = Math.max(0, Math.min(1, b.z));
            const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            const goalX = (0.82 - 0.5) * 7.4;
            const targetX = (b.aimX / a.game.layout.width - 0.5) * 7.4;
            const targetZ = -1.35 - Math.tan(-0.52) * (targetX - goalX);
            return Math.abs(r.ball.position.z - (1.4 + (targetZ - 1.4) * e));
        }"""
    )
    check("demo: shot follows the angled goal plane", alignment < 0.001, str(alignment))
    page.wait_for_timeout(530)
    shot(page, "03-demo-flight.png")
    flying = page.evaluate("window.__app.snapshot().ballState")
    check("demo: forced kick launches ball", flying in ("flying", "dead"), flying)

    page.click("#btn-settings")
    page.wait_for_timeout(500)
    check("demo: settings panel opens", page.is_visible("#settings"))
    check(
        "demo: three avatar styles offered",
        page.eval_on_selector_all("#seg-avatar button", "els => els.length") == 3,
    )

    page.click("#seg-avatar button[data-value='3d']")
    page.wait_for_timeout(300)
    check(
        "demo: switch to 3D",
        page.evaluate("window.__app.settings.avatar") == "3d",
        page.evaluate("window.__app.settings.avatar"),
    )
    page.click("#btn-close-settings")
    page.wait_for_timeout(900)
    check(
        "demo: 3D player driven by landmarks",
        page.evaluate("window.__app.renderer.scene3d.player.root.visible && !document.getElementById('stage3d').classList.contains('hidden')"),
    )
    shot(page, "09-3d-mode.png")

    page.click("#btn-settings")
    page.wait_for_timeout(500)
    page.click("#seg-avatar button[data-value='real']")
    page.wait_for_timeout(300)
    check(
        "demo: switch to real cutout",
        page.evaluate("window.__app.settings.avatar") == "real",
        page.evaluate("window.__app.settings.avatar"),
    )
    page.click("#btn-close-settings")
    page.wait_for_timeout(700)
    check("demo: 3D hidden in real mode", page.evaluate("document.getElementById('stage3d').classList.contains('hidden')"))
    check("demo: real mode uses front layout", page.evaluate("window.__app.game.layout.sideView") is False)
    shot(page, "08-real-mode.png")

    page.click("#btn-settings")
    page.wait_for_timeout(500)
    page.click("#seg-avatar button[data-value='stylized']")
    page.wait_for_timeout(300)
    check(
        "demo: switch back to stylized",
        page.evaluate("window.__app.settings.avatar") == "stylized",
        page.evaluate("window.__app.settings.avatar"),
    )
    shot(page, "04-settings.png")
    page.click("#btn-close-settings")
    page.wait_for_timeout(200)
    check("demo: clean console", not page.errors, "; ".join(page.errors[:3]))
    page.close()


def test_avatar_kick(browser):
    page = new_page(browser)
    page.goto(f"{BASE}/?demo=1")
    playing = wait_for(page, "window.__app && window.__app.state.mode === 'playing'", 25)
    check("avatar: demo reaches playing", bool(playing))
    kicked = page.evaluate(
        """() => new Promise((resolve) => {
            const d = window.__app.state.demo;
            if (!d || !d.cycle) return resolve(false);
            const deadline = performance.now() + 11000;
            const tick = () => {
                const ph = ((performance.now() - d.t0) / 1000) % d.cycle;
                if (ph >= 2.55 && ph <= 2.85) return resolve(true);
                if (performance.now() > deadline) return resolve(false);
                requestAnimationFrame(tick);
            };
            tick();
        })"""
    )
    check("avatar: captures kick phase", bool(kicked))
    shot(page, "07-avatar-kick.png")
    page.close()


def test_camera(browser):
    page = new_page(browser, permissions=["camera"])
    page.goto(f"{BASE}/")
    page.wait_for_timeout(1200)
    page.click("#btn-start")
    playing = wait_for(page, "window.__app && window.__app.state.mode === 'playing'", 40)
    check("camera: reaches playing", bool(playing))
    page.click("#btn-settings")
    page.click("#seg-avatar button[data-value='stylized']")
    page.click("#btn-close-settings")
    wait_for(page, "window.__app.renderer.papercut.rendered > 0", 5)
    info = page.evaluate(
        """() => { const a = window.__app; return {
            source: a.state.source,
            visible: a.game.input.visible,
            feet: a.game.input.feet.length,
            delegate: a.state.tracker?.delegate,
            video: a.state.video.videoWidth + 'x' + a.state.video.videoHeight,
            mask: !!a.state.tracker?.state.mask,
            stylized: a.renderer.papercut.rendered,
        } }"""
    )
    check("camera: real pose tracked", info["visible"] and info["feet"] >= 1, str(info))
    check("camera: segmentation mask ready", info["mask"], str(info))
    check("camera: stylized cutout rendering", info["stylized"] > 0, str(info))
    page.wait_for_timeout(1200)
    shot(page, "05-camera.png")
    page.close()


def test_photo(browser):
    page = new_page(browser)
    page.goto(f"{BASE}/?photo=/tests/fixtures/kid-kick.jpg")
    ok = wait_for(
        page,
        "window.__app && window.__app.state.photoSample && window.__app.state.photoSample.visible",
        25,
    )
    check("photo: model finds the child", bool(ok))
    sample = page.evaluate(
        """() => { const s = window.__app.state.photoSample; return {
            h: Math.round(s.personHeight), feet: s.feet.length, mask: !!s.mask,
            delegate: s.delegate, ms: Math.round(s.detectMs) } }"""
    )
    check("photo: full body landmarks", sample["h"] > 200 and sample["feet"] == 2, str(sample))
    check("photo: segmentation available", sample["mask"], str(sample))
    page.wait_for_timeout(600)
    shot(page, "06-photo.png")
    page.close()


def main():
    with sync_playwright() as p:
        happy = p.chromium.launch(args=GL_ARGS)
        test_home(happy)
        test_demo(happy)
        test_avatar_kick(happy)
        test_photo(happy)
        happy.close()

        cam = p.chromium.launch(args=CAMERA_ARGS)
        try:
            test_camera(cam)
        finally:
            cam.close()

    print()
    if failures:
        print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main()
