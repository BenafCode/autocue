(function () {
  "use strict";

  var STORAGE_KEY = "autocue-state-v1";
  var DEFAULT_WPM = 130; // tunable: average conversational speaking pace
  var MIN_SPEED = 1, MAX_SPEED = 10, DEFAULT_SPEED = 5;
  var PX_PER_SEC_PER_SPEED_UNIT = 12; // speed 5 => ~60px/s baseline scroll rate
  var DRAG_THRESHOLD = 10; // px of movement before a touch/click counts as a drag, not a tap
  var RESUME_DELAY_MS = 2000;
  var CHROME_LINGER_MS = 2500; // how long chrome stays up after resuming before auto-hiding

  var state = {
    script: "",
    fontSize: "medium",
    scrollSpeed: DEFAULT_SPEED,
  };

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && typeof saved === "object") {
          if (typeof saved.script === "string") state.script = saved.script;
          if (typeof saved.fontSize === "string") state.fontSize = saved.fontSize;
          if (typeof saved.scrollSpeed === "number") state.scrollSpeed = saved.scrollSpeed;
        }
      }
    } catch (e) {
      /* localStorage unavailable (e.g. private mode) — fall back to in-memory defaults */
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage full or unavailable — nothing more we can do */
    }
  }

  // ---------- Share link ----------
  // The script travels in the URL fragment (never sent to a server, no
  // length limit imposed by GitHub Pages) as UTF-8-safe base64url, so a
  // recipient's browser can decode it purely client-side.

  function utf8ToBase64Url(str) {
    var bytes = new TextEncoder().encode(str);
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlToUtf8(b64url) {
    var base64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function buildShareUrl() {
    return location.origin + location.pathname + "#s=" + utf8ToBase64Url(state.script);
  }

  function loadSharedScriptFromHash() {
    var match = /(?:^|[#&])s=([^&]+)/.exec(location.hash);
    if (!match) return;
    try {
      var decoded = base64UrlToUtf8(match[1]);
      if (decoded) {
        state.script = decoded;
        saveState();
      }
    } catch (e) {
      /* malformed share link — ignore, keep whatever script was already saved */
    } finally {
      // Strip the (potentially huge) fragment so reloads/edits don't re-decode it
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  // ---------- DOM refs ----------
  var body = document.body;
  var scriptInput = document.getElementById("script-input");
  var fontSizeOptions = document.getElementById("font-size-options");
  var scrollSpeedInput = document.getElementById("scroll-speed");
  var speedValueEl = document.getElementById("speed-value");
  var estTimeEl = document.getElementById("est-time");
  var startBtn = document.getElementById("start-btn");
  var shareBtn = document.getElementById("share-btn");
  var shareFeedbackEl = document.getElementById("share-feedback");

  var chromeTop = document.getElementById("chrome-top");
  var chromeBottom = document.getElementById("chrome-bottom");
  var elapsedTimeEl = document.getElementById("elapsed-time");
  var liveDot = document.getElementById("live-dot");
  var progressFill = document.getElementById("progress-fill");
  var wakelockNote = document.getElementById("wakelock-note");
  var scriptScroll = document.getElementById("script-scroll");
  var scriptContent = document.getElementById("script-content");
  var playPauseBtn = document.getElementById("play-pause-btn");
  var speedDownBtn = document.getElementById("speed-down-btn");
  var speedUpBtn = document.getElementById("speed-up-btn");
  var prompterSpeedValueEl = document.getElementById("prompter-speed-value");
  var restartBtn = document.getElementById("restart-btn");
  var exitBtn = document.getElementById("exit-btn");

  // ---------- Setup screen ----------

  function formatEstTime() {
    var words = state.script.trim().length ? state.script.trim().split(/\s+/).length : 0;
    var minutesFloat = words / DEFAULT_WPM;
    var totalSeconds = Math.round(minutesFloat * 60);
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    estTimeEl.textContent = m + ":" + (s < 10 ? "0" : "") + s + " AT " + DEFAULT_WPM + " WPM";
  }

  function updateFontSizeUI() {
    var buttons = fontSizeOptions.querySelectorAll(".text-btn");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("active", buttons[i].dataset.size === state.fontSize);
    }
  }

  function initSetupScreen() {
    scriptInput.value = state.script;
    scrollSpeedInput.value = state.scrollSpeed;
    speedValueEl.textContent = state.scrollSpeed;
    updateFontSizeUI();
    formatEstTime();

    scriptInput.addEventListener("input", function () {
      state.script = scriptInput.value;
      formatEstTime();
      saveState();
    });

    fontSizeOptions.addEventListener("click", function (e) {
      var btn = e.target.closest(".text-btn");
      if (!btn) return;
      state.fontSize = btn.dataset.size;
      updateFontSizeUI();
      saveState();
    });

    scrollSpeedInput.addEventListener("input", function () {
      state.scrollSpeed = Number(scrollSpeedInput.value);
      speedValueEl.textContent = state.scrollSpeed;
      saveState();
    });

    startBtn.addEventListener("click", enterPrompterScreen);
    shareBtn.addEventListener("click", shareScript);
  }

  var shareFeedbackTimer = null;

  function flashShareFeedback(message) {
    shareFeedbackEl.textContent = message;
    shareFeedbackEl.hidden = false;
    clearTimeout(shareFeedbackTimer);
    shareFeedbackTimer = setTimeout(function () {
      shareFeedbackEl.hidden = true;
    }, 2000);
  }

  function shareScript() {
    if (!state.script.trim()) return;
    var url = buildShareUrl();
    if (navigator.share) {
      navigator.share({ title: "Autocue script", url: url }).catch(function () {
        /* user cancelled the share sheet — nothing to do */
      });
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        flashShareFeedback("Link Copied");
      }).catch(function () {
        window.prompt("Copy this link:", url);
      });
    } else {
      window.prompt("Copy this link:", url);
    }
  }

  // ---------- Teleprompter screen ----------

  var isPlaying = false;
  var manuallyPaused = false;
  var elapsedMs = 0;
  var lastFrameTime = null;
  var rafId = null;
  var resumeTimer = null;
  var wakeLockSentinel = null;
  // Float accumulator driving auto-scroll: `scrollTop` truncates to an integer
  // on every write in some engines, so at low speeds the sub-pixel per-frame
  // delta gets silently discarded and the scroll appears to freeze. Tracking
  // position separately preserves the fractional progress across frames.
  var scrollPos = 0;

  function syncScrollPosFromDOM() {
    scrollPos = scriptScroll.scrollTop;
  }

  function renderScriptBlocks() {
    var blocks = state.script.split(/\n\s*\n/).map(function (b) { return b.trim(); }).filter(Boolean);
    scriptContent.innerHTML = "";
    scriptContent.dataset.fontSize = state.fontSize;
    if (blocks.length === 0) blocks = [""];
    blocks.forEach(function (block) {
      var p = document.createElement("p");
      p.textContent = block;
      scriptContent.appendChild(p);
    });
  }

  function formatElapsed(ms) {
    var totalSeconds = Math.floor(ms / 1000);
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  function updateTimerUI() {
    elapsedTimeEl.textContent = formatElapsed(elapsedMs);
  }

  function updateProgressUI() {
    var max = scriptScroll.scrollHeight - scriptScroll.clientHeight;
    var pct = max > 0 ? Math.min(1, Math.max(0, scriptScroll.scrollTop / max)) : 0;
    progressFill.style.width = (pct * 100) + "%";
  }

  function updateLiveDot() {
    liveDot.classList.toggle("live", isPlaying);
  }

  var chromeHideTimer = null;

  function showChromeNow() {
    chromeTop.classList.remove("hidden");
    chromeBottom.classList.remove("hidden");
  }

  function hideChromeNow() {
    chromeTop.classList.add("hidden");
    chromeBottom.classList.add("hidden");
  }

  function updateChromeVisibility() {
    clearTimeout(chromeHideTimer);
    if (!isPlaying) {
      // Paused (however that happened): chrome stays up indefinitely so
      // Play/Pause, speed, Restart and Exit are all reachable.
      showChromeNow();
      return;
    }
    // Playing: keep chrome up briefly after a resume (so a released hold
    // still leaves the controls reachable for a moment, reels-style tap
    // notwithstanding) then auto-hide for a clean, uncluttered read.
    showChromeNow();
    chromeHideTimer = setTimeout(function () {
      if (isPlaying) hideChromeNow();
    }, CHROME_LINGER_MS);
  }

  function updatePlayPauseUI() {
    playPauseBtn.textContent = isPlaying ? "▮▮" : "▶";
    updateLiveDot();
    updateChromeVisibility();
  }

  function tick(now) {
    if (lastFrameTime === null) lastFrameTime = now;
    var dt = now - lastFrameTime;
    lastFrameTime = now;

    if (isPlaying) {
      elapsedMs += dt;
      var pxPerSec = state.scrollSpeed * PX_PER_SEC_PER_SPEED_UNIT;
      scrollPos += (pxPerSec * dt) / 1000;
      scriptScroll.scrollTop = scrollPos;
      updateTimerUI();
    }
    updateProgressUI();
    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    lastFrameTime = null;
    if (rafId === null) rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function scheduleResume() {
    clearTimeout(resumeTimer);
    if (manuallyPaused) return;
    resumeTimer = setTimeout(function () {
      if (!manuallyPaused) {
        syncScrollPosFromDOM(); // pick up wherever native/manual scrolling left off
        isPlaying = true;
        updatePlayPauseUI();
      }
    }, RESUME_DELAY_MS);
  }

  function pauseForManualScroll() {
    clearTimeout(resumeTimer);
    isPlaying = false;
    updatePlayPauseUI();
  }

  function resumeFromHold() {
    // Reels-style: releasing a tap-hold resumes immediately, unless the user
    // had explicitly paused with the Play/Pause button — that stays paused
    // until they explicitly press it again.
    if (manuallyPaused) return;
    syncScrollPosFromDOM();
    isPlaying = true;
    updatePlayPauseUI();
  }

  function togglePlayPause() {
    clearTimeout(resumeTimer);
    if (isPlaying) {
      isPlaying = false;
      manuallyPaused = true;
    } else {
      syncScrollPosFromDOM(); // pick up wherever native/manual scrolling left off
      isPlaying = true;
      manuallyPaused = false;
    }
    updatePlayPauseUI();
  }

  function adjustSpeed(delta) {
    state.scrollSpeed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, state.scrollSpeed + delta));
    scrollSpeedInput.value = state.scrollSpeed;
    speedValueEl.textContent = state.scrollSpeed;
    prompterSpeedValueEl.textContent = state.scrollSpeed;
    saveState();
  }

  function restart() {
    scrollPos = 0;
    scriptScroll.scrollTop = 0;
    elapsedMs = 0;
    updateTimerUI();
    updateProgressUI();
  }

  // ---------- Manual scroll / tap-to-pause handling ----------
  // Reels-style: pressing down pauses immediately. Releasing without having
  // dragged resumes immediately (a tap/hold). Releasing after a drag (a
  // scrub through the script) instead resumes after a short delay, since
  // that's a deliberate reposition rather than a momentary hold.
  // Touch: rely on native overflow scrolling for the actual movement. Mouse:
  // no native drag-to-scroll on a div, so pointer events move scrollTop
  // directly (useful for desktop testing).

  var touchStartY = 0, touchMoved = false;
  var mouseDown = false, mouseStartY = 0, mouseStartScrollTop = 0, mouseMoved = false;

  function attachScrollHandlers() {
    scriptScroll.addEventListener("touchstart", function (e) {
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
      pauseForManualScroll();
    }, { passive: true });

    scriptScroll.addEventListener("touchmove", function (e) {
      if (Math.abs(e.touches[0].clientY - touchStartY) > DRAG_THRESHOLD) touchMoved = true;
    }, { passive: true });

    scriptScroll.addEventListener("touchend", function () {
      if (touchMoved) {
        scheduleResume();
      } else {
        resumeFromHold();
      }
    });

    scriptScroll.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse") return;
      mouseDown = true;
      mouseMoved = false;
      mouseStartY = e.clientY;
      mouseStartScrollTop = scriptScroll.scrollTop;
      pauseForManualScroll();
    });

    scriptScroll.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse" || !mouseDown) return;
      var deltaY = e.clientY - mouseStartY;
      if (Math.abs(deltaY) > DRAG_THRESHOLD) mouseMoved = true;
      if (mouseMoved) {
        scriptScroll.scrollTop = mouseStartScrollTop - deltaY;
      }
    });

    scriptScroll.addEventListener("pointerup", function (e) {
      if (e.pointerType !== "mouse" || !mouseDown) return;
      mouseDown = false;
      if (mouseMoved) {
        scheduleResume();
      } else {
        resumeFromHold();
      }
    });

    scriptScroll.addEventListener("wheel", function () {
      pauseForManualScroll();
      scheduleResume();
    }, { passive: true });
  }

  // ---------- Wake Lock ----------

  function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      wakelockNote.hidden = false;
      return;
    }
    navigator.wakeLock.request("screen").then(function (sentinel) {
      wakeLockSentinel = sentinel;
    }).catch(function () {
      /* request can be denied (e.g. low battery) — nothing actionable to do */
    });
  }

  function releaseWakeLock() {
    if (wakeLockSentinel) {
      wakeLockSentinel.release().catch(function () {});
      wakeLockSentinel = null;
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && body.dataset.screen === "prompter" && "wakeLock" in navigator) {
      requestWakeLock();
    }
  });

  // ---------- Screen transitions ----------

  function enterPrompterScreen() {
    renderScriptBlocks();
    prompterSpeedValueEl.textContent = state.scrollSpeed;
    isPlaying = true;
    manuallyPaused = false;
    elapsedMs = 0;
    body.dataset.screen = "prompter";
    scrollPos = 0;
    scriptScroll.scrollTop = 0;
    updatePlayPauseUI();
    updateTimerUI();
    updateProgressUI();
    startLoop();
    requestWakeLock();
  }

  function exitPrompterScreen() {
    clearTimeout(resumeTimer);
    stopLoop();
    releaseWakeLock();
    isPlaying = false;
    body.dataset.screen = "setup";
  }

  function initPrompterScreen() {
    attachScrollHandlers();
    playPauseBtn.addEventListener("click", togglePlayPause);
    speedDownBtn.addEventListener("click", function () { adjustSpeed(-1); });
    speedUpBtn.addEventListener("click", function () { adjustSpeed(1); });
    restartBtn.addEventListener("click", restart);
    exitBtn.addEventListener("click", exitPrompterScreen);
  }

  // ---------- Service worker ----------

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(function () {
        /* offline support degrades gracefully if registration fails */
      });
    }
  }

  // ---------- Init ----------

  loadState();
  loadSharedScriptFromHash();
  initSetupScreen();
  initPrompterScreen();
  registerServiceWorker();
})();
