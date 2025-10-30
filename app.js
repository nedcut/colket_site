(() => {
  const stage = document.getElementById("stage");
  const selectEl = document.getElementById("layoutSelect");
  const imgEl = document.getElementById("svgView");
  const fitBtn = document.getElementById("fitBtn");
  const zoom = document.getElementById("zoomRange");
  const zoomOut = document.getElementById("zoomOut");
  const openRaw = document.getElementById("openRaw");
  const download = document.getElementById("download");
  const caption = document.getElementById("caption");
  const year = document.getElementById("year");

  const baseTitle = document.title;
  const stageInitialTabIndex = stage.getAttribute("tabindex") || "0";
  const zoomBounds = {
    min: Number.parseFloat(zoom.min) || 0.25,
    max: Number.parseFloat(zoom.max) || 2.5,
    step: Number.parseFloat(zoom.step) || 0.05,
  };

  const state = {
    manifest: [],
    current: null,
    tx: 0,
    ty: 0,
    autoFit: true,
    pendingFit: true,
  };

  year.textContent = new Date().getFullYear();
  openRaw.target = "_blank";
  openRaw.rel = "noopener";

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function isInteractionReady() {
    return stage.dataset.state === "ready";
  }

  function setStageStatus(nextState, message = "") {
    stage.dataset.state = nextState;
    stage.setAttribute("data-message", message || "");
    const busy = nextState === "loading";
    stage.setAttribute("aria-busy", busy ? "true" : "false");
    if (nextState !== "ready") {
      imgEl.hidden = true;
    }
  }

  function setControlsEnabled(enabled) {
    fitBtn.disabled = !enabled;
    zoom.disabled = !enabled;
    if (enabled) {
      stage.setAttribute("tabindex", stageInitialTabIndex);
    } else {
      stage.setAttribute("tabindex", "-1");
      if (document.activeElement === stage) {
        stage.blur();
      }
    }
  }

  function setActionLinks(url, ready) {
    const links = [openRaw, download];
    links.forEach((link) => {
      if (ready) {
        link.setAttribute("href", url);
        link.removeAttribute("aria-disabled");
        link.removeAttribute("tabindex");
      } else {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
        link.setAttribute("tabindex", "-1");
      }
    });
    if (ready) {
      const filename = url.split("/").pop() || "layout.svg";
      download.setAttribute("download", filename);
    } else {
      download.removeAttribute("download");
    }
  }

  function exitAutoFit() {
    state.autoFit = false;
    state.pendingFit = false;
  }

  function setZoom(value, options = {}) {
    const { updateSlider = true, manual = true } = options;
    const clamped = clamp(value, zoomBounds.min, zoomBounds.max);
    imgEl.style.setProperty("--scale", String(clamped));
    if (updateSlider) {
      zoom.value = clamped.toFixed(2);
    }
    zoomOut.textContent = Math.round(clamped * 100) + "%";
    if (manual) exitAutoFit();
  }

  function setPan(nx, ny, options = {}) {
    const manual = typeof options === "boolean" ? options : options.manual ?? true;
    state.tx = nx;
    state.ty = ny;
    imgEl.style.setProperty("--tx", state.tx + "px");
    imgEl.style.setProperty("--ty", state.ty + "px");
    if (manual) exitAutoFit();
  }

  function fitToStage({ invokedByUser = false } = {}) {
    if (!imgEl.naturalWidth || !imgEl.naturalHeight) {
      state.pendingFit = true;
      return;
    }

    const pad = 24;
    const rect = stage.getBoundingClientRect();
    const availW = rect.width - pad;
    const availH = rect.height - pad;
    if (availW <= 0 || availH <= 0) return;

    const targetScale = clamp(
      Math.min(availW / imgEl.naturalWidth, availH / imgEl.naturalHeight),
      zoomBounds.min,
      zoomBounds.max
    );

    const scaledW = imgEl.naturalWidth * targetScale;
    const scaledH = imgEl.naturalHeight * targetScale;
    const offsetX = Math.max((rect.width - scaledW) / 2, pad / 2);
    const offsetY = Math.max((rect.height - scaledH) / 2, pad / 2);

    state.autoFit = true;
    state.pendingFit = false;
    setZoom(targetScale, { updateSlider: true, manual: false });
    setPan(offsetX, offsetY, { manual: false });

    if (invokedByUser) {
      stage.focus({ preventScroll: true });
    }
  }

  function applyInitialView() {
    setZoom(1, { manual: false });
    setPan(0, 0, { manual: false });
    state.autoFit = true;
    state.pendingFit = true;
  }

  function loadById(id) {
    if (!state.manifest.length) return;
    const item = state.manifest.find((d) => d.id === id) || state.manifest[0];
    if (!item) {
      setStageStatus("empty", "No drawings available yet.");
      setControlsEnabled(false);
      setActionLinks("", false);
      caption.textContent = "";
      document.title = baseTitle;
      return;
    }

    if (state.current && state.current.id === item.id && imgEl.complete && isInteractionReady()) {
      // Already showing this layout; nothing to do.
      return;
    }

    state.current = item;
    selectEl.value = item.id;
    caption.textContent = item.label + (item.notes ? " — " + item.notes : "");
    document.title = item.label + " · " + baseTitle;

    const url = "svgs/" + item.file;
    setStageStatus("loading", 'Loading "' + item.label + '"...');
    setControlsEnabled(false);
    setActionLinks(url, false);
    applyInitialView();

    imgEl.alt = "Table layout drawing — " + item.label;
    imgEl.hidden = true;
    imgEl.src = url;

    if (history.replaceState) {
      history.replaceState(null, "", "?id=" + encodeURIComponent(item.id));
    }
  }

  function handleKey(e) {
    if (!isInteractionReady()) return;

    const targetTag = e.target && e.target.tagName;
    if (targetTag) {
      const tag = targetTag.toUpperCase();
      if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag)) return;
    }
    if (e.target && e.target.isContentEditable) return;

    const currentZoom = Number.parseFloat(zoom.value) || 1;

    switch (e.key) {
      case "f":
      case "F":
        e.preventDefault();
        fitToStage({ invokedByUser: true });
        break;
      case "+":
      case "=":
        if (e.ctrlKey || e.metaKey) break;
        e.preventDefault();
        setZoom(currentZoom + zoomBounds.step);
        break;
      case "-":
        if (e.ctrlKey || e.metaKey) break;
        e.preventDefault();
        setZoom(currentZoom - zoomBounds.step);
        break;
      case "ArrowLeft":
        e.preventDefault();
        {
          const delta = e.shiftKey ? 40 : 10;
          setPan(state.tx - delta, state.ty);
        }
        break;
      case "ArrowRight":
        e.preventDefault();
        {
          const delta = e.shiftKey ? 40 : 10;
          setPan(state.tx + delta, state.ty);
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        {
          const delta = e.shiftKey ? 40 : 10;
          setPan(state.tx, state.ty - delta);
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        {
          const delta = e.shiftKey ? 40 : 10;
          setPan(state.tx, state.ty + delta);
        }
        break;
      default:
        break;
    }
  }

  function enablePointerPanning() {
    let activePointer = null;
    let sx = 0;
    let sy = 0;

    function stopPan(pointerId) {
      if (activePointer !== pointerId) return;
      if (stage.hasPointerCapture && stage.hasPointerCapture(pointerId)) {
        stage.releasePointerCapture(pointerId);
      }
      activePointer = null;
      stage.classList.remove("is-panning");
    }

    stage.addEventListener("pointerdown", (e) => {
      if (!isInteractionReady()) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      activePointer = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
      stage.setPointerCapture(activePointer);
      stage.classList.add("is-panning");
    });

    stage.addEventListener("pointermove", (e) => {
      if (activePointer !== e.pointerId) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      sx = e.clientX;
      sy = e.clientY;
      setPan(state.tx + dx, state.ty + dy);
    });

    stage.addEventListener("pointerup", (e) => {
      stopPan(e.pointerId);
    });
    stage.addEventListener("pointercancel", (e) => {
      stopPan(e.pointerId);
    });
    stage.addEventListener("lostpointercapture", (e) => {
      stopPan(e.pointerId);
    });
  }

  function setupWheelZoom() {
    window.addEventListener(
      "wheel",
      (e) => {
        if (!isInteractionReady()) return;
        const withinStage = e.target === stage || stage.contains(e.target);
        if (!withinStage) return;
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const direction = e.deltaY < 0 ? 1 : -1;
          const currentZoom = Number.parseFloat(zoom.value) || 1;
          setZoom(currentZoom + direction * zoomBounds.step);
        }
      },
      { passive: false }
    );
  }

  function setupResizeHandling() {
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(() => {
        if (state.autoFit && isInteractionReady()) {
          fitToStage({ invokedByUser: false });
        }
      });
      observer.observe(stage);
    } else {
      window.addEventListener("resize", () => {
        if (state.autoFit && isInteractionReady()) {
          fitToStage({ invokedByUser: false });
        }
      });
    }
  }

  imgEl.addEventListener("load", () => {
    if (!state.current) return;
    imgEl.hidden = false;
    setActionLinks(imgEl.src, true);
    setStageStatus("ready", "");
    setControlsEnabled(true);
    if (state.pendingFit || state.autoFit) {
      fitToStage({ invokedByUser: false });
    }
  });

  imgEl.addEventListener("error", () => {
    console.error("Failed to load image:", imgEl.src);
    setStageStatus("error", "Unable to load drawing. Please try another option.");
    setControlsEnabled(false);
    setActionLinks("", false);
    if (state.current) {
      caption.textContent = 'Unable to load drawing for "' + state.current.label + '".';
    }
    document.title = baseTitle;
  });

  fitBtn.addEventListener("click", () => {
    if (!isInteractionReady()) return;
    fitToStage({ invokedByUser: true });
  });

  zoom.addEventListener("input", () => {
    const value = Number.parseFloat(zoom.value) || 1;
    setZoom(value, { updateSlider: false });
  });

  selectEl.addEventListener("change", () => {
    loadById(selectEl.value);
  });

  window.addEventListener("keydown", handleKey);
  enablePointerPanning();
  setupWheelZoom();
  setupResizeHandling();

  setStageStatus("loading", "Loading configurations...");
  setControlsEnabled(false);
  setActionLinks("", false);

  fetch("options.json")
    .then((response) => {
      if (!response.ok) {
        throw new Error("Request failed with status " + response.status);
      }
      return response.json();
    })
    .then((list) => {
      if (!Array.isArray(list) || !list.length) {
        throw new Error("No layout entries found");
      }
      state.manifest = list;
      selectEl.disabled = false;
      selectEl.innerHTML = list
        .map((opt) => `<option value="${opt.id}">${opt.label}</option>`)
        .join("");

      const params = new URLSearchParams(location.search);
      const requestedId = params.get("id");
      loadById(requestedId || list[0].id);
    })
    .catch((err) => {
      console.error("Failed to load options:", err);
      selectEl.disabled = true;
      selectEl.innerHTML = `<option>Unable to load configurations</option>`;
      setStageStatus("error", "Unable to load configuration list.");
      caption.textContent = "";
      document.title = baseTitle;
    });
})();
