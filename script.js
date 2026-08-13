/* =========================================================
   Photobooth+ — app logic
   Everything here runs client-side. No network calls, no
   uploads — captured photos are kept in IndexedDB so the
   reel survives a reload even while fully offline.
   ========================================================= */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const video          = $("#video");
  const viewfinder     = $("#viewfinder");
  const captureCanvas  = $("#captureCanvas");
  const countdownEl    = $("#countdown");
  const flashEl        = $("#flash");
  const shutterBtn     = $("#shutterBtn");
  const switchCamBtn   = $("#switchCamBtn");
  const filtersWrap    = $("#filters");
  const timerWrap       = $("#timerOptions");
  const stripStylesWrap= $("#stripStyles");
  const customTemplateInput = $("#customTemplateInput");
  const downloadTemplateBtn = $("#downloadTemplateBtn");
  const modeButtons    = document.querySelectorAll(".mode-btn");
  const statusDot      = $("#statusDot");
  const statusText     = $("#statusText");
  const cameraError    = $("#cameraError");
  const filmstripScroll= $("#filmstripScroll");
  const filmstripEmpty = $("#filmstripEmpty");
  const clearReelBtn   = $("#clearReelBtn");
  const previewOverlay = $("#previewOverlay");
  const previewImg     = $("#previewImg");
  const previewClose   = $("#previewClose");
  const previewDownload= $("#previewDownload");
  const previewPrint   = $("#previewPrint");

  const FILTERS = {
    none:    "none",
    bw:      "grayscale(1) contrast(1.1)",
    sepia:   "sepia(0.8) contrast(1.05) brightness(1.05)",
    vintage: "sepia(0.35) saturate(1.4) contrast(0.9) brightness(1.05) hue-rotate(-8deg)",
    vivid:   "saturate(1.6) contrast(1.15)",
    cool:    "saturate(1.15) hue-rotate(15deg) brightness(1.05) contrast(1.05)"
  };

  let currentFilter = "none";
  let currentMode = "single";     // "single" | "strip" | "gif"
  let currentStripStyle = "classic"; // "classic" | "noir" | "polaroid" | "custom"
  let currentTimer = 3;           // seconds, chosen from the Timer chips
  let customTemplateImg = null;   // user's uploaded strip design, if any
  let stream = null;
  let devices = [];
  let deviceIndex = 0;
  let busy = false;

  /* -------------------- IndexedDB (offline reel storage) -------------------- */
  const DB_NAME = "photobooth-plus";
  const STORE = "photos";
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function savePhoto(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadPhotos() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => a.createdAt - b.createdAt));
      req.onerror = () => reject(req.error);
    });
  }

  async function clearPhotos() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* -------------------- Camera -------------------- */
  async function startCamera(preferredDeviceId) {
    statusText.textContent = "starting camera…";
    statusDot.classList.remove("is-live");
    cameraError.hidden = true;

    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }

    const constraints = {
      audio: false,
      video: preferredDeviceId
        ? { deviceId: { exact: preferredDeviceId } }
        : { facingMode: "user" }
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      statusText.textContent = "camera live";
      statusDot.classList.add("is-live");
      cameraError.hidden = true;

      // Match the on-screen box to the camera's *actual* aspect ratio
      // (webcams are rarely exactly 4:3) so the preview never crops
      // anything the capture doesn't also crop, and vice versa.
      video.addEventListener(
        "loadedmetadata",
        () => {
          if (video.videoWidth && video.videoHeight) {
            viewfinder.style.setProperty("--cam-ratio", `${video.videoWidth} / ${video.videoHeight}`);
          }
        },
        { once: true }
      );

      // The <video> tag already has the `autoplay` attribute, so it will
      // start showing frames on its own the moment srcObject is attached.
      // Calling .play() here is just a nudge for browsers that need it —
      // if it rejects (e.g. AbortError from a rapid reassignment), that's
      // not a real camera failure, so it must never re-trigger the error
      // overlay over an otherwise-working feed.
      video.play().catch((playErr) => {
        console.warn("video.play() did not resolve, relying on autoplay:", playErr);
      });

      // Likewise, a failure here (some browsers restrict device
      // *labels/enumeration* on a plain file:// origin even though
      // getUserMedia itself was allowed) should never undo the success
      // above — just hide the switch-camera button and move on.
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        devices = all.filter((d) => d.kind === "videoinput");
        switchCamBtn.hidden = devices.length < 2;
      } catch (enumErr) {
        console.warn("Could not enumerate camera devices:", enumErr);
        devices = [];
        switchCamBtn.hidden = true;
      }
    } catch (err) {
      console.error("Camera error:", err);
      statusText.textContent = "camera unavailable";
      cameraError.hidden = false;
    }
  }

  switchCamBtn.addEventListener("click", () => {
    if (devices.length < 2) return;
    deviceIndex = (deviceIndex + 1) % devices.length;
    startCamera(devices[deviceIndex].deviceId);
  });

  /* -------------------- Filters -------------------- */
  filtersWrap.addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");
    if (!chip) return;
    currentFilter = chip.dataset.filter;
    video.style.filter = FILTERS[currentFilter];
    filtersWrap.querySelectorAll(".filter-chip").forEach((c) =>
      c.classList.toggle("is-active", c === chip)
    );
  });

  /* -------------------- Timer -------------------- */
  timerWrap.addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");
    if (!chip || !chip.dataset.timer) return;
    currentTimer = parseInt(chip.dataset.timer, 10);
    timerWrap.querySelectorAll(".filter-chip").forEach((c) =>
      c.classList.toggle("is-active", c === chip)
    );
  });

  /* -------------------- Mode -------------------- */
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentMode = btn.dataset.mode;
      modeButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
      stripStylesWrap.hidden = currentMode !== "strip";
    });
  });

  /* -------------------- Strip design -------------------- */
  stripStylesWrap.addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");
    if (!chip || !chip.dataset.stripStyle) return;
    currentStripStyle = chip.dataset.stripStyle;
    stripStylesWrap.querySelectorAll(".filter-chip[data-strip-style]").forEach((c) =>
      c.classList.toggle("is-active", c === chip)
    );
  });

  const CUSTOM_TEMPLATE_KEY = "photobooth-plus-custom-template";

  function loadStoredTemplate() {
    try {
      const stored = localStorage.getItem(CUSTOM_TEMPLATE_KEY);
      if (!stored) return;
      const img = new Image();
      img.onload = () => { customTemplateImg = img; };
      img.src = stored;
    } catch (e) {
      console.warn("Could not load a saved custom template:", e);
    }
  }

  customTemplateInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      try {
        localStorage.setItem(CUSTOM_TEMPLATE_KEY, dataUrl);
      } catch (err) {
        console.warn("Design saved for this session only (too large to persist):", err);
      }
      const img = new Image();
      img.onload = () => {
        customTemplateImg = img;
        currentStripStyle = "custom";
        stripStylesWrap.querySelectorAll(".filter-chip[data-strip-style]").forEach((c) =>
          c.classList.toggle("is-active", c.dataset.stripStyle === "custom")
        );
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });

  // Exports a blank guide, sized to exactly match the strip canvas this
  // browser will compose, with the four photo windows marked — design
  // around it in any image editor, then upload the result as "Custom".
  downloadTemplateBtn.addEventListener("click", () => {
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 960;
    const pad = Math.round(w * 0.035);
    const gap = Math.round(w * 0.03);
    const footer = Math.round(h * 0.16);
    const stripW = w + pad * 2;
    const stripH = pad + (h + gap) * 4 + footer;

    const canvas = document.createElement("canvas");
    canvas.width = stripW;
    canvas.height = stripH;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#f6f1e7";
    ctx.fillRect(0, 0, stripW, stripH);

    ctx.strokeStyle = "rgba(43,35,32,0.4)";
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = Math.max(2, Math.round(w * 0.004));
    ctx.fillStyle = "rgba(43,35,32,0.55)";
    ctx.textAlign = "center";
    ctx.font = `${Math.round(h * 0.07)}px ui-monospace, monospace`;

    for (let i = 0; i < 4; i++) {
      const y = pad + i * (h + gap);
      ctx.strokeRect(pad, y, w, h);
      ctx.fillText(`Photo ${i + 1}`, stripW / 2, y + h / 2);
    }

    ctx.setLineDash([]);
    ctx.textAlign = "left";
    ctx.font = `${Math.round(footer * 0.16)}px ui-monospace, monospace`;
    ctx.fillStyle = "rgba(43,35,32,0.55)";
    ctx.fillText(
      `Canvas size: ${stripW}×${stripH}px — keep these 4 windows clear, then upload your finished design as a Custom strip.`,
      pad,
      stripH - footer * 0.18,
      stripW - pad * 2
    );

    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "photobooth-plus-template-guide.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  /* -------------------- Capture helpers -------------------- */
  function drawFrame(ctx, w, h) {
    ctx.save();
    ctx.filter = FILTERS[currentFilter];
    // mirror to match the preview
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
  }

  function fireFlash() {
    flashEl.classList.remove("is-flashing");
    void flashEl.offsetWidth; // restart animation
    flashEl.classList.add("is-flashing");
  }

  // While a countdown is running, this holds a function that ends it right
  // away (used when the person taps the shutter/viewfinder early to grab
  // the moment before the timer finishes).
  let countdownSkip = null;

  function runCountdown(seconds) {
    return new Promise((resolve) => {
      let n = seconds;
      let timeoutId = null;

      viewfinder.classList.add("is-counting");
      countdownEl.textContent = n;
      countdownEl.classList.remove("is-active");
      void countdownEl.offsetWidth;
      countdownEl.classList.add("is-active");

      const finish = () => {
        clearTimeout(timeoutId);
        viewfinder.classList.remove("is-counting");
        countdownSkip = null;
        resolve();
      };

      countdownSkip = finish;

      const tick = () => {
        n -= 1;
        if (n > 0) {
          countdownEl.textContent = n;
          countdownEl.classList.remove("is-active");
          void countdownEl.offsetWidth;
          countdownEl.classList.add("is-active");
          timeoutId = setTimeout(tick, 1000);
        } else {
          finish();
        }
      };
      timeoutId = setTimeout(tick, 1000);
    });
  }

  async function captureSingleFrame() {
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 960;
    captureCanvas.width = w;
    captureCanvas.height = h;
    const ctx = captureCanvas.getContext("2d");
    drawFrame(ctx, w, h);
    fireFlash();
    return captureCanvas.toDataURL("image/jpeg", 0.92);
  }

  function composeStrip(frames, style) {
    if (style === "noir") return composeStripNoir(frames);
    if (style === "polaroid") return composeStripPolaroid(frames);
    if (style === "custom") return composeStripCustom(frames);
    return composeStripClassic(frames);
  }

  // Custom: your uploaded design as the background, photos dropped into
  // the same four slots the blank-template guide marks out.
  function composeStripCustom(frames) {
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 960;
    const pad = Math.round(w * 0.035);
    const gap = Math.round(w * 0.03);
    const footer = Math.round(h * 0.16);

    const stripW = w + pad * 2;
    const stripH = pad + (h + gap) * frames.length + footer;

    const out = document.createElement("canvas");
    out.width = stripW;
    out.height = stripH;
    const ctx = out.getContext("2d");

    if (customTemplateImg) {
      const scale = Math.max(stripW / customTemplateImg.width, stripH / customTemplateImg.height);
      const dw = customTemplateImg.width * scale;
      const dh = customTemplateImg.height * scale;
      ctx.drawImage(customTemplateImg, (stripW - dw) / 2, (stripH - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = "#f6f1e7";
      ctx.fillRect(0, 0, stripW, stripH);
    }

    frames.forEach((_, i) => {
      const img = frameImages[i];
      const y = pad + i * (h + gap);
      ctx.drawImage(img, pad, y, w, h);
    });

    return out.toDataURL("image/jpeg", 0.92);
  }

  // Classic: cream photo-paper strip, one column, serif caption.
  function composeStripClassic(frames) {
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 960;
    const pad = Math.round(w * 0.035);
    const gap = Math.round(w * 0.03);
    const footer = Math.round(h * 0.16);

    const stripW = w + pad * 2;
    const stripH = pad + (h + gap) * frames.length + footer;

    const out = document.createElement("canvas");
    out.width = stripW;
    out.height = stripH;
    const ctx = out.getContext("2d");

    ctx.fillStyle = "#f6f1e7";
    ctx.fillRect(0, 0, stripW, stripH);

    frames.forEach((_, i) => {
      const img = frameImages[i];
      const y = pad + i * (h + gap);
      ctx.drawImage(img, pad, y, w, h);
    });

    ctx.fillStyle = "#2b2320";
    ctx.font = `${Math.round(footer * 0.34)}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.fillText("Photobooth+", stripW / 2, stripH - footer * 0.55);
    ctx.font = `${Math.round(footer * 0.2)}px ui-monospace, monospace`;
    ctx.fillStyle = "#6b5c4f";
    ctx.fillText(new Date().toLocaleString(), stripW / 2, stripH - footer * 0.22);

    return out.toDataURL("image/jpeg", 0.92);
  }

  // Noir: black filmstrip with sprocket holes down both edges, like real 35mm stock.
  function composeStripNoir(frames) {
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 960;
    const rail = Math.round(w * 0.07);   // sprocket rail width on each side
    const gap = Math.round(w * 0.025);
    const footer = Math.round(h * 0.14);
    const pad = Math.round(w * 0.02);

    const stripW = w + pad * 2 + rail * 2;
    const stripH = pad + (h + gap) * frames.length + footer;

    const out = document.createElement("canvas");
    out.width = stripW;
    out.height = stripH;
    const ctx = out.getContext("2d");

    ctx.fillStyle = "#0d0d0e";
    ctx.fillRect(0, 0, stripW, stripH);

    // sprocket holes
    const holeR = Math.max(4, Math.round(rail * 0.16));
    const holeGap = Math.round(holeR * 4.4);
    ctx.fillStyle = "#f6f1e7";
    for (let y = holeGap / 2; y < stripH; y += holeGap) {
      ctx.beginPath();
      ctx.arc(rail / 2, y, holeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(stripW - rail / 2, y, holeR, 0, Math.PI * 2);
      ctx.fill();
    }

    frames.forEach((_, i) => {
      const img = frameImages[i];
      const y = pad + i * (h + gap);
      ctx.drawImage(img, rail + pad, y, w, h);
    });

    ctx.fillStyle = "#f6f1e7";
    ctx.textAlign = "center";
    ctx.font = `${Math.round(footer * 0.32)}px Georgia, serif`;
    ctx.fillText("PHOTOBOOTH+", stripW / 2, stripH - footer * 0.55);
    ctx.font = `${Math.round(footer * 0.18)}px ui-monospace, monospace`;
    ctx.fillStyle = "#b8b0a4";
    ctx.fillText(new Date().toLocaleString(), stripW / 2, stripH - footer * 0.22);

    return out.toDataURL("image/jpeg", 0.92);
  }

  // Polaroid: 2xN grid of individually-bordered instant-photo cards.
  function composeStripPolaroid(frames) {
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 960;
    const cols = frames.length > 1 ? 2 : 1;
    const rows = Math.ceil(frames.length / cols);

    const border = Math.round(w * 0.045);
    const bottomBorder = Math.round(h * 0.16);
    const cardW = w + border * 2;
    const cardH = h + border * 2 + bottomBorder;
    const gap = Math.round(w * 0.05);
    const outerPad = gap;
    const footer = Math.round(h * 0.1);

    const sheetW = cols * cardW + (cols - 1) * gap + outerPad * 2;
    const sheetH = rows * cardH + (rows - 1) * gap + outerPad * 2 + footer;

    const out = document.createElement("canvas");
    out.width = sheetW;
    out.height = sheetH;
    const ctx = out.getContext("2d");

    ctx.fillStyle = "#d8d3c6";
    ctx.fillRect(0, 0, sheetW, sheetH);

    frames.forEach((_, i) => {
      const img = frameImages[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cardX = outerPad + col * (cardW + gap);
      const cardY = outerPad + row * (cardH + gap);

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = Math.round(w * 0.01);
      ctx.shadowOffsetY = Math.round(w * 0.006);
      ctx.fillStyle = "#fbfaf6";
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.restore();

      ctx.drawImage(img, cardX + border, cardY + border, w, h);

      ctx.fillStyle = "#5a5248";
      ctx.font = `${Math.round(bottomBorder * 0.32)}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.fillText(
        `#${i + 1}`,
        cardX + cardW / 2,
        cardY + border * 2 + h + bottomBorder * 0.62
      );
    });

    ctx.fillStyle = "#3a352c";
    ctx.font = `${Math.round(footer * 0.55)}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.fillText("Photobooth+ · " + new Date().toLocaleDateString(), sheetW / 2, sheetH - footer * 0.32);

    return out.toDataURL("image/jpeg", 0.92);
  }

  let frameImages = [];
  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = src;
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function bytesToDataURL(bytes, mime) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  }

  const GIF_MAX_WIDTH = 360;      // downscaled for reasonable file size / encode time
  const GIF_FRAME_COUNT = 12;
  const GIF_FRAME_INTERVAL_MS = 120; // ~1.4s of motion total

  async function captureGifBurst() {
    const nativeW = video.videoWidth || 1280;
    const nativeH = video.videoHeight || 960;
    const scale = Math.min(1, GIF_MAX_WIDTH / nativeW);
    const gw = Math.max(2, Math.round(nativeW * scale));
    const gh = Math.max(2, Math.round(nativeH * scale));

    const off = document.createElement("canvas");
    off.width = gw;
    off.height = gh;
    const octx = off.getContext("2d");

    fireFlash();
    const palette = PhotoboothGIF.buildFixedPalette();
    const frames = [];
    for (let i = 0; i < GIF_FRAME_COUNT; i++) {
      drawFrame(octx, gw, gh);
      const imageData = octx.getImageData(0, 0, gw, gh);
      const indices = PhotoboothGIF.quantizeFrame(imageData.data, gw, gh);
      frames.push({ indices, delayCs: Math.round(GIF_FRAME_INTERVAL_MS / 10) });
      if (i < GIF_FRAME_COUNT - 1) await sleep(GIF_FRAME_INTERVAL_MS);
    }

    statusText.textContent = "encoding gif…";
    const bytes = PhotoboothGIF.encodeGIF({ width: gw, height: gh, palette, frames, loop: 0 });
    return bytesToDataURL(bytes, "image/gif");
  }

  // A wait that countdownSkip() can resolve immediately, so tapping
  // during a GIF countdown feels as instant as it does for photos.
  let pendingWaitResolve = null;
  let pendingWaitTimeout = null;
  function cancelableWait(ms) {
    return new Promise((resolve) => {
      pendingWaitResolve = resolve;
      pendingWaitTimeout = setTimeout(() => {
        pendingWaitTimeout = null;
        pendingWaitResolve = null;
        resolve();
      }, ms);
    });
  }

  // Records the countdown itself: a frame is grabbed roughly every
  // frameInterval, spread across the whole timer, so the GIF captures
  // whatever happened on camera while the numbers were counting down —
  // not just the instant after they hit zero.
  async function captureGifDuringCountdown(seconds) {
    const nativeW = video.videoWidth || 1280;
    const nativeH = video.videoHeight || 960;
    const scale = Math.min(1, GIF_MAX_WIDTH / nativeW);
    const gw = Math.max(2, Math.round(nativeW * scale));
    const gh = Math.max(2, Math.round(nativeH * scale));

    const off = document.createElement("canvas");
    off.width = gw;
    off.height = gh;
    const octx = off.getContext("2d");

    const totalMs = seconds * 1000;
    const frameCount = GIF_FRAME_COUNT;
    const frameInterval = totalMs / frameCount;
    const palette = PhotoboothGIF.buildFixedPalette();
    const frames = [];

    viewfinder.classList.add("is-counting");
    let displayedSecond = seconds;
    countdownEl.textContent = displayedSecond;
    countdownEl.classList.remove("is-active");
    void countdownEl.offsetWidth;
    countdownEl.classList.add("is-active");

    let skipped = false;
    countdownSkip = () => {
      skipped = true;
      if (pendingWaitTimeout) clearTimeout(pendingWaitTimeout);
      if (pendingWaitResolve) {
        const r = pendingWaitResolve;
        pendingWaitResolve = null;
        r();
      }
    };

    const startTime = performance.now();
    for (let i = 0; i < frameCount && !skipped; i++) {
      drawFrame(octx, gw, gh);
      const imageData = octx.getImageData(0, 0, gw, gh);
      const indices = PhotoboothGIF.quantizeFrame(imageData.data, gw, gh);
      frames.push({ indices, delayCs: Math.max(2, Math.round(frameInterval / 10)) });

      const elapsed = performance.now() - startTime;
      const remaining = Math.max(1, Math.ceil((totalMs - elapsed) / 1000));
      if (remaining !== displayedSecond) {
        displayedSecond = remaining;
        countdownEl.textContent = displayedSecond;
        countdownEl.classList.remove("is-active");
        void countdownEl.offsetWidth;
        countdownEl.classList.add("is-active");
      }

      if (i < frameCount - 1 && !skipped) await cancelableWait(frameInterval);
    }

    if (frames.length === 0) {
      // an extremely fast skip could leave us with nothing — grab one frame
      drawFrame(octx, gw, gh);
      const imageData = octx.getImageData(0, 0, gw, gh);
      frames.push({ indices: PhotoboothGIF.quantizeFrame(imageData.data, gw, gh), delayCs: 20 });
    }

    fireFlash();
    viewfinder.classList.remove("is-counting");
    countdownSkip = null;

    statusText.textContent = "encoding gif…";
    const bytes = PhotoboothGIF.encodeGIF({ width: gw, height: gh, palette, frames, loop: 0 });
    return bytesToDataURL(bytes, "image/gif");
  }

  /* -------------------- Shutter -------------------- */
  shutterBtn.addEventListener("click", async () => {
    if (busy) {
      // Mid-countdown tap: grab the moment now instead of waiting it out.
      if (countdownSkip) countdownSkip();
      return;
    }
    if (!stream) return;

    if (currentMode === "strip" && currentStripStyle === "custom" && !customTemplateImg) {
      alert("Upload your custom design first, or pick Classic / Noir / Polaroid instead.");
      return;
    }

    busy = true;
    shutterBtn.classList.add("is-busy");

    try {
      if (currentMode === "single") {
        if (currentTimer > 0) await runCountdown(currentTimer);
        const dataUrl = await captureSingleFrame();
        await addToReel(dataUrl, "single");
      } else if (currentMode === "strip") {
        const shots = [];
        for (let i = 0; i < 4; i++) {
          if (currentTimer > 0) await runCountdown(currentTimer);
          shots.push(await captureSingleFrame());
        }
        frameImages = await Promise.all(shots.map(loadImage));
        const stripUrl = composeStrip(shots, currentStripStyle);
        await addToReel(stripUrl, "strip");
      } else if (currentMode === "gif") {
        let dataUrl;
        if (currentTimer > 0) {
          dataUrl = await captureGifDuringCountdown(currentTimer);
        } else {
          statusText.textContent = "capturing gif…";
          dataUrl = await captureGifBurst();
        }
        statusText.textContent = "camera live";
        await addToReel(dataUrl, "gif");
      }
    } finally {
      busy = false;
      shutterBtn.classList.remove("is-busy");
      countdownEl.classList.remove("is-active");
      viewfinder.classList.remove("is-counting");
      countdownSkip = null;
    }
  });

  // Tapping the viewfinder itself is a bigger, easier target mid-countdown
  // (hands are often busy posing) — same "capture now" behaviour.
  viewfinder.addEventListener("click", () => {
    if (busy && countdownSkip) countdownSkip();
  });

  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" && e.code !== "Enter") return;
    if (!previewOverlay.hidden) return; // let Enter/Space work normally on preview buttons
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "LABEL") return;
    if (tag === "BUTTON" && active !== shutterBtn) return; // don't hijack other buttons' own Enter/Space
    e.preventDefault();
    shutterBtn.click();
  });

  /* -------------------- Reel rendering -------------------- */
  async function addToReel(dataUrl, type) {
    const record = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, dataUrl, type, createdAt: Date.now() };
    await savePhoto(record);
    renderFrame(record, true);
    openPreview(dataUrl);
  }

  function renderFrame(record, prepend) {
    filmstripEmpty.hidden = true;
    const card = document.createElement("div");
    card.className = "frame-card";
    card.dataset.id = record.id;

    const img = document.createElement("img");
    img.src = record.dataUrl;
    img.alt = record.type === "strip" ? "Four photo strip" : record.type === "gif" ? "Animated GIF burst" : "Photobooth snapshot";

    const meta = document.createElement("div");
    meta.className = "frame-meta";
    const time = new Date(record.createdAt);
    const typeLabel = record.type === "strip" ? "strip" : record.type === "gif" ? "gif" : "shot";
    meta.textContent = `${typeLabel} · ${time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

    card.appendChild(img);
    card.appendChild(meta);
    card.addEventListener("click", () => openPreview(record.dataUrl));

    if (prepend && filmstripScroll.firstChild) {
      filmstripScroll.insertBefore(card, filmstripScroll.firstChild);
    } else {
      filmstripScroll.appendChild(card);
    }
  }

  async function renderExistingReel() {
    const photos = await loadPhotos();
    if (!photos.length) {
      filmstripEmpty.hidden = false;
      return;
    }
    filmstripEmpty.hidden = true;
    photos.slice().reverse().forEach((p) => renderFrame(p, false));
  }

  clearReelBtn.addEventListener("click", async () => {
    if (!confirm("Clear every photo in this reel? This can't be undone.")) return;
    await clearPhotos();
    filmstripScroll.querySelectorAll(".frame-card").forEach((c) => c.remove());
    filmstripEmpty.hidden = false;
  });

  /* -------------------- Preview overlay -------------------- */
  let previewDataUrl = null;

  function openPreview(dataUrl) {
    previewDataUrl = dataUrl;
    previewImg.src = dataUrl;
    previewOverlay.hidden = false;
  }

  function closePreview() {
    previewOverlay.hidden = true;
    previewDataUrl = null;
  }

  previewClose.addEventListener("click", closePreview);
  previewOverlay.addEventListener("click", (e) => {
    if (e.target === previewOverlay) closePreview();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !previewOverlay.hidden) closePreview();
  });

  previewDownload.addEventListener("click", () => {
    if (!previewDataUrl) return;
    const ext = /^data:image\/gif/.test(previewDataUrl) ? "gif" : "jpg";
    const a = document.createElement("a");
    a.href = previewDataUrl;
    a.download = `photobooth-plus-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  /* -------------------- Print -------------------- */
  // Prints via a hidden same-origin iframe rather than window.open(),
  // so it isn't blocked by popup blockers and needs no server.
  function printPhoto(dataUrl) {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(iframe);

    const cleanup = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(
      "<!DOCTYPE html><html><head><title>Photobooth+</title><style>" +
      "@page{ margin: 12mm; } html,body{ margin:0; padding:0; background:#fff; }" +
      "img{ display:block; width:100%; height:auto; }" +
      "</style></head><body><img id=\"p\" alt=\"Photobooth+ photo\"></body></html>"
    );
    doc.close();

    const img = doc.getElementById("p");
    img.addEventListener("load", () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // Give the print dialog a moment to open before tearing the iframe down.
      setTimeout(cleanup, 1500);
    });
    img.addEventListener("error", cleanup);
    img.src = dataUrl;
  }

  previewPrint.addEventListener("click", () => {
    if (!previewDataUrl) return;
    printPhoto(previewDataUrl);
  });

  /* -------------------- Offline status note --------------------
     No service worker here on purpose: this app is a handful of
     plain files meant to be opened straight from disk (double-click
     index.html), which already works with zero network calls. Service
     workers require an http(s) origin, so registering one would only
     matter if this were hosted — skip it to keep "just open the file"
     the whole story. */
  window.addEventListener("online", () => {
    $("#offlineNote").textContent = "Ready to work offline once loaded — nothing you capture ever leaves this browser.";
  });
  window.addEventListener("offline", () => {
    $("#offlineNote").textContent = "You're offline right now — Photobooth+ keeps working normally.";
  });

  /* -------------------- Init -------------------- */
  (async function init() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      statusText.textContent = "camera unsupported";
      cameraError.hidden = false;
      cameraError.textContent = "This browser doesn't support camera access. Try a recent Chrome, Edge, Firefox, or Safari.";
      return;
    }
    await renderExistingReel();
    loadStoredTemplate();
    await startCamera();
  })();
})();
