(function () {
  "use strict";

  var STORAGE_KEY = "autocue-state-v1";
  var DEFAULT_WPM = 130; // tunable: average conversational speaking pace
  var MIN_SPEED = 1, MAX_SPEED = 10, DEFAULT_SPEED = 5;
  var PX_PER_SEC_PER_SPEED_UNIT = 12; // speed 5 => ~60px/s baseline scroll rate
  var DRAG_THRESHOLD = 10; // px of movement before a touch/click counts as a drag, not a tap
  var RESUME_DELAY_MS = 2000;

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

  // ---------- DOM refs ----------
  var body = document.body;
  var scriptInput = document.getElementById("script-input");
  var fontSizeOptions = document.getElementById("font-size-options");
  var scrollSpeedInput = document.getElementById("scroll-speed");
  var estTimeEl = document.getElementById("est-time");
  var startBtn = document.getElementById("start-btn");

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
      saveState();
    });

    startBtn.addEventListener("click", enterPrompterScreen);
  }

  // ---------- Teleprompter screen ----------

  var isPlaying = false;
  var manuallyPaused = false;
  var elapsedMs = 0;
  var lastFrameTime = null;
  var rafId = null;
  var resumeTimer = null;
  var wakeLockSentinel = null;
  var chromeVisible = true;

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

  function updatePlayPauseUI() {
    playPauseBtn.textContent = isPlaying ? "▮▮" : "▶";
    updateLiveDot();
  }

  function tick(now) {
    if (lastFrameTime === null) lastFrameTime = now;
    var dt = now - lastFrameTime;
    lastFrameTime = now;

    if (isPlaying) {
      elapsedMs += dt;
      var pxPerSec = state.scrollSpeed * PX_PER_SEC_PER_SPEED_UNIT;
      scriptScroll.scrollTop += (pxPerSec * dt) / 1000;
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

  function setChromeVisible(visible) {
    chromeVisible = visible;
    chromeTop.classList.toggle("hidden", !visible);
    chromeBottom.classList.toggle("hidden", !visible);
  }

  function scheduleResume() {
    clearTimeout(resumeTimer);
    if (manuallyPaused) return;
    resumeTimer = setTimeout(function () {
      if (!manuallyPaused) {
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

  function togglePlayPause() {
    clearTimeout(resumeTimer);
    isPlaying = !isPlaying;
    manuallyPaused = !isPlaying;
    updatePlayPauseUI();
  }

  function adjustSpeed(delta) {
    state.scrollSpeed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, state.scrollSpeed + delta));
    scrollSpeedInput.value = state.scrollSpeed;
    saveState();
  }

  function restart() {
    scriptScroll.scrollTop = 0;
    elapsedMs = 0;
    updateTimerUI();
    updateProgressUI();
  }

  // ---------- Manual scroll / tap-to-hide-chrome handling ----------
  // Touch: rely on native overflow scrolling for the actual movement; we only
  // watch touch coordinates to tell a drag (pause autoscroll, let it scroll)
  // apart from a tap (toggle chrome). Mouse: no native drag-to-scroll on a
  // div, so pointer events move scrollTop directly (useful for desktop testing).

  var touchStartY = 0, touchMoved = false;
  var mouseDown = false, mouseStartY = 0, mouseStartScrollTop = 0, mouseMoved = false;

  function attachScrollHandlers() {
    scriptScroll.addEventListener("touchstart", function (e) {
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
    }, { passive: true });

    scriptScroll.addEventListener("touchmove", function (e) {
      var wasMoved = touchMoved;
      if (Math.abs(e.touches[0].clientY - touchStartY) > DRAG_THRESHOLD) touchMoved = true;
      if (touchMoved && !wasMoved) pauseForManualScroll(); // only pause once it's confirmed a drag, not a tap
      clearTimeout(resumeTimer);
    }, { passive: true });

    scriptScroll.addEventListener("touchend", function () {
      if (touchMoved) {
        scheduleResume();
      } else {
        setChromeVisible(!chromeVisible);
      }
    });

    scriptScroll.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse") return;
      mouseDown = true;
      mouseMoved = false;
      mouseStartY = e.clientY;
      mouseStartScrollTop = scriptScroll.scrollTop;
    });

    scriptScroll.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse" || !mouseDown) return;
      var deltaY = e.clientY - mouseStartY;
      var wasMoved = mouseMoved;
      if (Math.abs(deltaY) > DRAG_THRESHOLD) mouseMoved = true;
      if (mouseMoved) {
        if (!wasMoved) pauseForManualScroll(); // only pause once it's confirmed a drag, not a tap/click
        scriptScroll.scrollTop = mouseStartScrollTop - deltaY;
        clearTimeout(resumeTimer);
      }
    });

    scriptScroll.addEventListener("pointerup", function (e) {
      if (e.pointerType !== "mouse" || !mouseDown) return;
      mouseDown = false;
      if (mouseMoved) {
        scheduleResume();
      } else {
        setChromeVisible(!chromeVisible);
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
    isPlaying = true;
    manuallyPaused = false;
    elapsedMs = 0;
    setChromeVisible(true);
    body.dataset.screen = "prompter";
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
  initSetupScreen();
  initPrompterScreen();
  registerServiceWorker();
})();
