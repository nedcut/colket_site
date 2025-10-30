(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const CANVAS_DIM = { width: 1600, height: 1000 };

  const refs = {
    canvas: document.getElementById("layoutCanvas"),
    canvasFrame: document.getElementById("canvasFrame"),
    contentLayer: document.getElementById("contentLayer"),
    gridLayer: document.getElementById("gridLayer"),
    tableShapeSelect: document.getElementById("tableShapeSelect"),
    zoomRange: document.getElementById("zoomRange"),
    totalLengthOut: document.getElementById("totalLengthOut"),
    seatCountOut: document.getElementById("seatCountOut"),
    footprintOut: document.getElementById("footprintOut"),
    autoArrangeCheck: document.getElementById("autoArrangeCheck"),
    autoArrangeBtn: document.getElementById("autoArrangeBtn"),
    resetViewBtn: document.getElementById("resetViewBtn"),
    addFreeChairBtn: document.getElementById("addFreeChairBtn"),
    clearManualBtn: document.getElementById("clearManualBtn"),
    canvasHint: document.getElementById("canvasHint"),
    dismissHintBtn: document.getElementById("dismissHintBtn"),
    year: document.getElementById("year"),
    customPresetName: document.getElementById("customPresetName"),
    savePresetBtn: document.getElementById("savePresetBtn"),
    savedPresetSelect: document.getElementById("savedPresetSelect"),
    loadPresetBtn: document.getElementById("loadPresetBtn"),
    deletePresetBtn: document.getElementById("deletePresetBtn"),
  };

  const CUSTOM_PRESET_STORAGE_KEY = "colketPlanner.customPresets.v1";

  const PRESETS = {
    A: { table: { baseLength: 102, leafCount: 0 }, seating: { sideCount: 2, endCount: 1 } },
    B: { table: { baseLength: 93, leafCount: 0 }, seating: { sideCount: 2, endCount: 1 } },
    C: { table: { baseLength: 102, leafCount: 1 }, seating: { sideCount: 3, endCount: 1 } },
    D: { table: { baseLength: 93, leafCount: 1 }, seating: { sideCount: 3, endCount: 1 } },
    E: { table: { baseLength: 102, leafCount: 2 }, seating: { sideCount: 4, endCount: 1 } },
    F: { table: { baseLength: 93, leafCount: 2 }, seating: { sideCount: 3, endCount: 1 } },
  };

  const state = {
    table: {
      shape: "capsule",
      baseLength: 120,
      width: 48,
      cornerRadius: 2,
      leafLength: 18,
      leafCount: 0,
      unitsPerInch: 6,
      position: { x: CANVAS_DIM.width / 2, y: CANVAS_DIM.height / 2 },
    },
    seating: {
      sideCount: 4,
      endCount: 1,
      chairWidth: 21,
      chairDepth: 22,
      clearance: 8,
      sideOffset: 6,
      endOffset: 2.5,
    },
    view: {
      zoom: 1,
    },
    manual: {
      positions: new Map(),
      selectedId: null,
    },
    customChairs: new Map(),
    flags: {
      autoArrange: true,
    },
    customPresets: {
      items: new Map(),
      selectedId: null,
    },
  };

  let floatingCounter = 0;
  let layoutDirty = true;
  let renderPending = false;
  let rafId = null;
  let latestLayout = null;
  let dragState = null;

  const coupledControls = [
    {
      range: "tableLengthRange",
      number: "tableLengthInput",
      handler: updateBaseLength,
      getter: () => state.table.baseLength,
    },
    {
      range: "tableWidthRange",
      number: "tableWidthInput",
      handler: updateTableWidth,
      getter: () => state.table.width,
    },
    {
      range: "cornerRadiusRange",
      number: "cornerRadiusInput",
      handler: updateCornerRadius,
      getter: () => state.table.cornerRadius,
    },
    {
      range: "unitsPerInchRange",
      number: "unitsPerInchInput",
      handler: updateUnitsPerInch,
      getter: () => state.table.unitsPerInch,
    },
    {
      range: "sideChairCountRange",
      number: "sideChairCountInput",
      handler: updateSideCount,
      getter: () => state.seating.sideCount,
      type: "int",
    },
    {
      range: "endChairCountRange",
      number: "endChairCountInput",
      handler: updateEndCount,
      getter: () => state.seating.endCount,
      type: "int",
    },
  ];

  const singleControls = [
    { id: "leafCountInput", handler: updateLeafCount, getter: () => state.table.leafCount, type: "int" },
    { id: "leafLengthInput", handler: updateLeafLength, getter: () => state.table.leafLength },
    { id: "chairWidthInput", handler: updateChairWidth, getter: () => state.seating.chairWidth },
    { id: "chairDepthInput", handler: updateChairDepth, getter: () => state.seating.chairDepth },
    { id: "chairClearanceInput", handler: updateChairClearance, getter: () => state.seating.clearance },
    { id: "sideOffsetInput", handler: updateSideOffset, getter: () => state.seating.sideOffset },
    { id: "endOffsetInput", handler: updateEndOffset, getter: () => state.seating.endOffset },
  ];

  init();

  function init() {
    if (refs.year) {
      refs.year.textContent = String(new Date().getFullYear());
    }
    setupControls();
    setupToolbar();
    setupPresets();
    setupCustomPresets();
    setupCanvasInteractions();
    setupKeyboardShortcuts();
    scheduleRender();
  }

  function setupControls() {
    coupledControls.forEach((entry) => {
      const rangeEl = document.getElementById(entry.range);
      const numberEl = document.getElementById(entry.number);
      if (!rangeEl || !numberEl) return;
      const parse = entry.type === "int" ? (val) => parseInt(val, 10) : parseFloat;

      const decimalsRange = entry.type === "int" ? 0 : inferDecimals(rangeEl.step);
      const decimalsNumber = entry.type === "int" ? 0 : inferDecimals(numberEl.step);
      const current = entry.getter ? entry.getter() : parse(numberEl.value);
      rangeEl.value = formatNumber(current, decimalsRange);
      numberEl.value = formatNumber(current, decimalsNumber);

      const commit = (raw, source) => {
        const value = normalizeValue(raw, source, entry.type === "int");
        if (value == null) return;
        const applied = entry.handler(value);
        if (source !== rangeEl) {
          rangeEl.value = formatNumber(applied, decimalsRange);
        }
        if (source !== numberEl) {
          numberEl.value = formatNumber(applied, decimalsNumber);
        }
      };

      rangeEl.addEventListener("input", () => commit(parse(rangeEl.value), rangeEl));
      numberEl.addEventListener("input", () => commit(parse(numberEl.value), numberEl));
    });

    singleControls.forEach((entry) => {
      const el = document.getElementById(entry.id);
      if (!el) return;
      const parse = entry.type === "int" ? (val) => parseInt(val, 10) : parseFloat;
      const decimals = entry.type === "int" ? 0 : inferDecimals(el.step);

      const current = entry.getter ? entry.getter() : parse(el.value);
      el.value = formatNumber(current, decimals);

      const commit = (raw) => {
        const value = normalizeValue(raw, el, entry.type === "int");
        if (value == null) return;
        const applied = entry.handler(value);
        el.value = formatNumber(applied, decimals);
      };

      el.addEventListener("input", () => commit(parse(el.value)));
    });

    if (refs.tableShapeSelect) {
      refs.tableShapeSelect.value = state.table.shape;
      refs.tableShapeSelect.addEventListener("change", () => {
        updateTableShape(refs.tableShapeSelect.value);
      });
    }

    syncShapeDependentControls();

    if (refs.autoArrangeCheck) {
      refs.autoArrangeCheck.checked = state.flags.autoArrange;
      refs.autoArrangeCheck.addEventListener("change", () => {
        setAutoArrange(refs.autoArrangeCheck.checked);
      });
    }
  }

  function setupToolbar() {
    if (refs.zoomRange) {
      refs.zoomRange.value = "1";
      refs.zoomRange.addEventListener("input", () => {
        const value = parseFloat(refs.zoomRange.value);
        updateZoom(value);
      });
    }

    if (refs.autoArrangeBtn) {
      refs.autoArrangeBtn.addEventListener("click", () => {
        autoArrangeNow();
      });
    }

    if (refs.resetViewBtn) {
      refs.resetViewBtn.addEventListener("click", () => {
        centerView();
      });
    }

    if (refs.addFreeChairBtn) {
      refs.addFreeChairBtn.addEventListener("click", () => {
        addFloatingChair();
      });
    }

    if (refs.clearManualBtn) {
      refs.clearManualBtn.addEventListener("click", () => {
        clearManualAdjustments();
      });
    }

    if (refs.dismissHintBtn) {
      refs.dismissHintBtn.addEventListener("click", () => hideHint());
    }
  }

  function setupPresets() {
    const presetButtons = document.querySelectorAll("[data-preset]");
    presetButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const presetId = btn.dataset.preset;
        applyPreset(presetId);
      });
    });
  }

  function setupCustomPresets() {
    hydrateCustomPresets();
    refreshCustomPresetOptions();
    updateCustomPresetControls();

    if (refs.customPresetName) {
      refs.customPresetName.addEventListener("input", () => {
        updateCustomPresetControls();
      });
      refs.customPresetName.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handleSaveCustomPreset();
        }
      });
    }

    if (refs.savePresetBtn) {
      refs.savePresetBtn.addEventListener("click", () => {
        handleSaveCustomPreset();
      });
    }

    if (refs.savedPresetSelect) {
      refs.savedPresetSelect.addEventListener("change", () => {
        const value = refs.savedPresetSelect.value;
        state.customPresets.selectedId = value || null;
        updateCustomPresetControls();
      });
    }

    if (refs.loadPresetBtn) {
      refs.loadPresetBtn.addEventListener("click", () => {
        loadSelectedCustomPreset();
      });
    }

    if (refs.deletePresetBtn) {
      refs.deletePresetBtn.addEventListener("click", () => {
        deleteSelectedCustomPreset();
      });
    }
  }

  function hydrateCustomPresets() {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return;
    }
    state.customPresets.items.clear();
    let stored;
    try {
      const raw = window.localStorage.getItem(CUSTOM_PRESET_STORAGE_KEY);
      if (!raw) return;
      stored = JSON.parse(raw);
    } catch (error) {
      console.warn("Unable to parse custom presets from storage.", error);
      return;
    }
    if (!Array.isArray(stored)) return;
    stored.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const { id, name, snapshot } = entry;
      if (typeof id !== "string" || typeof name !== "string") return;
      if (!isValidPresetSnapshot(snapshot)) return;
      state.customPresets.items.set(id, { name, snapshot });
    });
  }

  function refreshCustomPresetOptions() {
    if (!refs.savedPresetSelect) return;
    const select = refs.savedPresetSelect;
    const priorSelection = state.customPresets.selectedId;
    select.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = state.customPresets.items.size ? "Choose custom preset" : "None saved yet";
    select.appendChild(placeholder);

    state.customPresets.items.forEach((entry, id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = entry.name;
      select.appendChild(option);
    });

    if (priorSelection && state.customPresets.items.has(priorSelection)) {
      select.value = priorSelection;
      state.customPresets.selectedId = priorSelection;
    } else {
      select.value = "";
      state.customPresets.selectedId = null;
    }
  }

  function updateCustomPresetControls() {
    if (refs.customPresetName && refs.savePresetBtn) {
      const hasName = refs.customPresetName.value.trim().length > 0;
      refs.savePresetBtn.disabled = !hasName;
    }
    const hasSelection =
      Boolean(state.customPresets.selectedId) && state.customPresets.items.has(state.customPresets.selectedId);
    if (refs.loadPresetBtn) {
      refs.loadPresetBtn.disabled = !hasSelection;
    }
    if (refs.deletePresetBtn) {
      refs.deletePresetBtn.disabled = !hasSelection;
    }
  }

  function handleSaveCustomPreset() {
    if (!refs.customPresetName) return;
    const name = refs.customPresetName.value.trim();
    if (!name) return;
    const snapshot = capturePresetSnapshot();
    const existingId = findCustomPresetIdByName(name);
    const id = existingId || generatePresetId();
    state.customPresets.items.set(id, { name, snapshot });
    state.customPresets.selectedId = id;
    persistCustomPresets();
    refreshCustomPresetOptions();
    updateCustomPresetControls();
  }

  function capturePresetSnapshot() {
    return {
      table: {
        shape: state.table.shape,
        baseLength: state.table.baseLength,
        width: state.table.width,
        cornerRadius: state.table.cornerRadius,
        leafLength: state.table.leafLength,
        leafCount: state.table.leafCount,
        unitsPerInch: state.table.unitsPerInch,
      },
      seating: {
        sideCount: state.seating.sideCount,
        endCount: state.seating.endCount,
        chairWidth: state.seating.chairWidth,
        chairDepth: state.seating.chairDepth,
        clearance: state.seating.clearance,
        sideOffset: state.seating.sideOffset,
        endOffset: state.seating.endOffset,
      },
      flags: {
        autoArrange: state.flags.autoArrange,
      },
    };
  }

  function applyPresetSnapshot(snapshot) {
    if (!isValidPresetSnapshot(snapshot)) return;
    const { table, seating, flags } = snapshot;
    let touchedLayout = false;

    if (table) {
      if (typeof table.shape === "string") {
        const nextShape = table.shape === "rounded" ? "rounded" : "capsule";
        if (state.table.shape !== nextShape) {
          state.table.shape = nextShape;
          touchedLayout = true;
        }
      }
      if (typeof table.baseLength === "number") {
        const next = clamp(table.baseLength, 60, 180);
        if (state.table.baseLength !== next) {
          state.table.baseLength = next;
          touchedLayout = true;
        }
      }
      if (typeof table.width === "number") {
        const next = clamp(table.width, 36, 60);
        if (state.table.width !== next) {
          state.table.width = next;
          touchedLayout = true;
        }
      }
      if (typeof table.cornerRadius === "number") {
        const next = clamp(table.cornerRadius, 0, 8);
        if (state.table.cornerRadius !== next) {
          state.table.cornerRadius = next;
          touchedLayout = true;
        }
      }
      if (typeof table.leafLength === "number") {
        const next = clamp(table.leafLength, 0, 36);
        if (state.table.leafLength !== next) {
          state.table.leafLength = next;
          touchedLayout = true;
        }
      }
      if (typeof table.leafCount === "number") {
        const next = clamp(Math.round(table.leafCount), 0, 3);
        if (state.table.leafCount !== next) {
          state.table.leafCount = next;
          touchedLayout = true;
        }
      }
      if (typeof table.unitsPerInch === "number") {
        const next = clamp(table.unitsPerInch, 3, 12);
        if (Number.isFinite(next) && next > 0 && state.table.unitsPerInch !== next) {
          const factor = next / state.table.unitsPerInch;
          state.table.unitsPerInch = next;
          scaleManualPositions(factor);
          touchedLayout = true;
        }
      }
    }

    if (seating) {
      if (typeof seating.sideCount === "number") {
        const next = clamp(Math.round(seating.sideCount), 0, 5);
        if (state.seating.sideCount !== next) {
          state.seating.sideCount = next;
          touchedLayout = true;
        }
      }
      if (typeof seating.endCount === "number") {
        const next = clamp(Math.round(seating.endCount), 0, 2);
        if (state.seating.endCount !== next) {
          state.seating.endCount = next;
          touchedLayout = true;
        }
      }
      if (typeof seating.chairWidth === "number") {
        const next = clamp(seating.chairWidth, 18, 26);
        if (state.seating.chairWidth !== next) {
          state.seating.chairWidth = next;
          touchedLayout = true;
        }
      }
      if (typeof seating.chairDepth === "number") {
        const next = clamp(seating.chairDepth, 18, 28);
        if (state.seating.chairDepth !== next) {
          state.seating.chairDepth = next;
          touchedLayout = true;
        }
      }
      if (typeof seating.clearance === "number") {
        const next = clamp(seating.clearance, 0, 24);
        if (state.seating.clearance !== next) {
          state.seating.clearance = next;
          touchedLayout = true;
        }
      }
      if (typeof seating.sideOffset === "number") {
        const next = clamp(seating.sideOffset, 0, 24);
        if (state.seating.sideOffset !== next) {
          state.seating.sideOffset = next;
          touchedLayout = true;
        }
      }
      if (typeof seating.endOffset === "number") {
        const next = clamp(seating.endOffset, 0, 18);
        if (state.seating.endOffset !== next) {
          state.seating.endOffset = next;
          touchedLayout = true;
        }
      }
    }

    if (flags && typeof flags === "object" && typeof flags.autoArrange === "boolean") {
      if (state.flags.autoArrange !== flags.autoArrange) {
        state.flags.autoArrange = flags.autoArrange;
        touchedLayout = true;
      }
    }

    state.manual.positions.clear();
    state.customChairs.clear();
    state.manual.selectedId = null;
    touchedLayout = true;

    syncControlValues();

    if (touchedLayout) {
      triggerLayout();
    } else {
      scheduleRender();
    }
  }

  function loadSelectedCustomPreset() {
    if (!state.customPresets.selectedId) return;
    const entry = state.customPresets.items.get(state.customPresets.selectedId);
    if (!entry) return;
    applyPresetSnapshot(entry.snapshot);
  }

  function deleteSelectedCustomPreset() {
    if (!state.customPresets.selectedId) return;
    if (!state.customPresets.items.has(state.customPresets.selectedId)) return;
    state.customPresets.items.delete(state.customPresets.selectedId);
    state.customPresets.selectedId = null;
    persistCustomPresets();
    refreshCustomPresetOptions();
    updateCustomPresetControls();
  }

  function persistCustomPresets() {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return;
    }
    const payload = [];
    state.customPresets.items.forEach((entry, id) => {
      payload.push({ id, name: entry.name, snapshot: entry.snapshot });
    });
    try {
      window.localStorage.setItem(CUSTOM_PRESET_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn("Unable to persist custom presets.", error);
    }
  }

  function findCustomPresetIdByName(name) {
    const target = name.toLowerCase();
    for (const [id, entry] of state.customPresets.items) {
      if (entry.name.toLowerCase() === target) {
        return id;
      }
    }
    return null;
  }

  function isValidPresetSnapshot(candidate) {
    if (!candidate || typeof candidate !== "object") return false;
    const { table, seating, flags } = candidate;
    if (!table || typeof table !== "object") return false;
    if (!seating || typeof seating !== "object") return false;
    const tableKeys = ["baseLength", "width", "cornerRadius", "leafLength", "leafCount", "unitsPerInch"];
    for (const key of tableKeys) {
      if (table[key] != null && typeof table[key] !== "number") {
        return false;
      }
    }
    if (table.shape != null && typeof table.shape !== "string") return false;
    const seatingKeys = ["sideCount", "endCount", "chairWidth", "chairDepth", "clearance", "sideOffset", "endOffset"];
    for (const key of seatingKeys) {
      if (seating[key] != null && typeof seating[key] !== "number") {
        return false;
      }
    }
    if (flags != null) {
      if (typeof flags !== "object") return false;
      if (flags.autoArrange != null && typeof flags.autoArrange !== "boolean") return false;
    }
    return true;
  }

  function generatePresetId() {
    return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function setupCanvasInteractions() {
    if (!refs.canvas) return;

    refs.canvas.addEventListener("pointerdown", handlePointerDown);
    refs.canvas.addEventListener("pointermove", handlePointerMove);
    refs.canvas.addEventListener("pointerup", handlePointerUp);
    refs.canvas.addEventListener("pointercancel", handlePointerUp);
    refs.canvas.addEventListener("lostpointercapture", handlePointerUp);
    refs.canvas.addEventListener("dblclick", handleDoubleClick);
  }

  function setupKeyboardShortcuts() {
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        state.manual.selectedId = null;
        scheduleRender();
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (!state.manual.selectedId) return;
        const id = state.manual.selectedId;
        if (state.customChairs.has(id)) {
          state.customChairs.delete(id);
          state.manual.selectedId = null;
          layoutDirty = true;
          scheduleRender();
          event.preventDefault();
        }
      }
    });
  }

  function updateBaseLength(value) {
    const next = clamp(value, 60, 180);
    if (!Number.isFinite(next)) return state.table.baseLength;
    if (state.table.baseLength === next) return next;
    state.table.baseLength = next;
    triggerLayout();
    return next;
  }

  function updateTableWidth(value) {
    const next = clamp(value, 36, 60);
    if (!Number.isFinite(next)) return state.table.width;
    if (state.table.width === next) return next;
    state.table.width = next;
    triggerLayout();
    return next;
  }

  function updateCornerRadius(value) {
    const next = clamp(value, 0, 8);
    if (!Number.isFinite(next)) return state.table.cornerRadius;
    if (state.table.cornerRadius === next) return next;
    state.table.cornerRadius = next;
    triggerLayout(false);
    return next;
  }

  function updateTableShape(value) {
    const next = value === "capsule" ? "capsule" : "rounded";
    if (state.table.shape === next) {
      syncShapeDependentControls();
      return state.table.shape;
    }
    state.table.shape = next;
    syncShapeDependentControls();
    triggerLayout(false);
    return state.table.shape;
  }

  function syncShapeDependentControls() {
    const isCapsule = state.table.shape === "capsule";
    const rangeEl = document.getElementById("cornerRadiusRange");
    const numberEl = document.getElementById("cornerRadiusInput");
    [rangeEl, numberEl].forEach((el) => {
      if (!el) return;
      el.disabled = isCapsule;
    });
  }

  function updateLeafCount(value) {
    let next = Math.round(clamp(value, 0, 3));
    if (!Number.isFinite(next)) next = 0;
    if (state.table.leafCount === next) return next;
    state.table.leafCount = next;
    triggerLayout();
    return next;
  }

  function updateLeafLength(value) {
    const next = clamp(value, 0, 36);
    if (!Number.isFinite(next)) return state.table.leafLength;
    if (state.table.leafLength === next) return next;
    state.table.leafLength = next;
    triggerLayout();
    return next;
  }

  function updateUnitsPerInch(value) {
    const next = clamp(value, 3, 12);
    if (!Number.isFinite(next) || next <= 0) return state.table.unitsPerInch;
    if (state.table.unitsPerInch === next) return next;
    const factor = next / state.table.unitsPerInch;
    state.table.unitsPerInch = next;
    scaleManualPositions(factor);
    triggerLayout(false);
    return next;
  }

  function updateSideCount(value) {
    let next = Math.round(clamp(value, 0, 5));
    if (!Number.isFinite(next)) next = 0;
    if (state.seating.sideCount === next) return next;
    state.seating.sideCount = next;
    triggerLayout();
    return next;
  }

  function updateEndCount(value) {
    let next = Math.round(clamp(value, 0, 2));
    if (!Number.isFinite(next)) next = 0;
    if (state.seating.endCount === next) return next;
    state.seating.endCount = next;
    triggerLayout();
    return next;
  }

  function updateChairWidth(value) {
    const next = clamp(value, 18, 26);
    if (!Number.isFinite(next)) return state.seating.chairWidth;
    if (state.seating.chairWidth === next) return next;
    state.seating.chairWidth = next;
    triggerLayout(false);
    return next;
  }

  function updateChairDepth(value) {
    const next = clamp(value, 18, 28);
    if (!Number.isFinite(next)) return state.seating.chairDepth;
    if (state.seating.chairDepth === next) return next;
    state.seating.chairDepth = next;
    triggerLayout(false);
    return next;
  }

  function updateChairClearance(value) {
    const next = clamp(value, 0, 24);
    if (!Number.isFinite(next)) return state.seating.clearance;
    if (state.seating.clearance === next) return next;
    state.seating.clearance = next;
    triggerLayout(false);
    return next;
  }

  function updateSideOffset(value) {
    const next = clamp(value, 0, 24);
    if (!Number.isFinite(next)) return state.seating.sideOffset;
    if (state.seating.sideOffset === next) return next;
    state.seating.sideOffset = next;
    triggerLayout(false);
    return next;
  }

  function updateEndOffset(value) {
    const next = clamp(value, 0, 18);
    if (!Number.isFinite(next)) return state.seating.endOffset;
    if (state.seating.endOffset === next) return next;
    state.seating.endOffset = next;
    triggerLayout(false);
    return next;
  }

  function updateZoom(value) {
    const next = clamp(value, 0.6, 2.5);
    state.view.zoom = next;
    if (refs.canvas) {
      refs.canvas.style.transform = `scale(${next})`;
    }
  }

  function setAutoArrange(enabled) {
    state.flags.autoArrange = Boolean(enabled);
    if (state.flags.autoArrange) {
      autoArrangeNow();
    }
  }

  function autoArrangeNow() {
    state.manual.positions.clear();
    state.manual.selectedId = null;
    triggerLayout(false);
  }

  function centerView() {
    state.table.position.x = CANVAS_DIM.width / 2;
    state.table.position.y = CANVAS_DIM.height / 2;
    updateZoom(1);
    if (refs.zoomRange) {
      refs.zoomRange.value = "1";
    }
    scheduleRender();
  }

  function addFloatingChair() {
    const seatDepthPx = toPixels(state.seating.chairDepth);
    const clearancePx = toPixels(state.seating.clearance + 6);
    const tableHeightPx = toPixels(state.table.width);
    const id = `floating-${++floatingCounter}`;
    const chair = {
      id,
      x: state.table.position.x,
      y: state.table.position.y + tableHeightPx / 2 + clearancePx + seatDepthPx / 2,
      rotation: 180,
    };
    state.customChairs.set(id, chair);
    state.manual.selectedId = id;
    hideHint();
    layoutDirty = true;
    scheduleRender();
  }

  function clearManualAdjustments() {
    state.manual.positions.clear();
    state.customChairs.clear();
    state.manual.selectedId = null;
    layoutDirty = true;
    scheduleRender();
  }

  function applyPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;
    if (preset.table) {
      if (typeof preset.table.baseLength === "number") {
        state.table.baseLength = clamp(preset.table.baseLength, 60, 180);
      }
      if (typeof preset.table.leafCount === "number") {
        state.table.leafCount = clamp(Math.round(preset.table.leafCount), 0, 3);
      }
      if (typeof preset.table.leafLength === "number") {
        state.table.leafLength = clamp(preset.table.leafLength, 0, 36);
      }
    }
    if (preset.seating) {
      if (typeof preset.seating.sideCount === "number") {
        state.seating.sideCount = clamp(Math.round(preset.seating.sideCount), 0, 5);
      }
      if (typeof preset.seating.endCount === "number") {
        state.seating.endCount = clamp(Math.round(preset.seating.endCount), 0, 2);
      }
    }
    syncControlValues();
    autoArrangeNow();
  }

  function syncControlValues() {
    coupledControls.forEach((entry) => {
      const rangeEl = document.getElementById(entry.range);
      const numberEl = document.getElementById(entry.number);
      if (!rangeEl || !numberEl) return;
      const decimalsRange = entry.type === "int" ? 0 : inferDecimals(rangeEl.step);
      const decimalsNumber = entry.type === "int" ? 0 : inferDecimals(numberEl.step);
      const currentValue = entry.getter ? entry.getter() : 0;
      rangeEl.value = formatNumber(currentValue, decimalsRange);
      numberEl.value = formatNumber(currentValue, decimalsNumber);
    });

    singleControls.forEach((entry) => {
      const el = document.getElementById(entry.id);
      if (!el) return;
      const decimals = entry.type === "int" ? 0 : inferDecimals(el.step);
      const currentValue = entry.getter ? entry.getter() : 0;
      el.value = formatNumber(currentValue, decimals);
    });

    if (refs.tableShapeSelect) {
      refs.tableShapeSelect.value = state.table.shape;
    }

    syncShapeDependentControls();

    if (refs.autoArrangeCheck) {
      refs.autoArrangeCheck.checked = state.flags.autoArrange;
    }
  }

  function hideHint() {
    if (refs.canvasHint) {
      refs.canvasHint.classList.add("hidden");
    }
  }

  function handlePointerDown(event) {
    if (!refs.canvas) return;
    const target = event.target.closest("[data-draggable]");
    if (!target) return;

    if (layoutDirty) {
      flushRenderImmediate();
    }

    hideHint();

    const kind = target.dataset.draggable;
    const id = target.dataset.id;
    const canvasPoint = clientToCanvas(event);

    if (kind === "chair" && !id) return;

    dragState = {
      pointerId: event.pointerId,
      target,
      type: kind,
      id,
      floating: target.dataset.floating === "true",
      startCanvas: canvasPoint,
      origin: kind === "table" ? { ...state.table.position } : getChairOrigin(id),
      constrainAxis: null,
    };

    if (!dragState.origin) {
      dragState = null;
      return;
    }

    if (kind === "chair") {
      state.manual.selectedId = id;
    }

    refs.canvas.setPointerCapture(event.pointerId);
    document.body.dataset.dragging = "true";
    target.classList.add("is-active");
  }

  function handlePointerMove(event) {
    if (!dragState) return;
    const { pointerId } = dragState;
    if (event.pointerId !== pointerId) return;

    const now = clientToCanvas(event);
    let dx = now.x - dragState.startCanvas.x;
    let dy = now.y - dragState.startCanvas.y;

    if (event.shiftKey) {
      if (!dragState.constrainAxis) {
        dragState.constrainAxis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
    } else {
      dragState.constrainAxis = null;
    }

    if (dragState.constrainAxis === "x") {
      dy = 0;
    } else if (dragState.constrainAxis === "y") {
      dx = 0;
    }

    if (dragState.type === "table") {
      state.table.position.x = dragState.origin.x + dx;
      state.table.position.y = dragState.origin.y + dy;
      triggerLayout(false);
    } else if (dragState.type === "chair") {
      const nextX = dragState.origin.x + dx;
      const nextY = dragState.origin.y + dy;

      if (dragState.floating) {
        const chair = state.customChairs.get(dragState.id);
        if (chair) {
          chair.x = nextX;
          chair.y = nextY;
        }
      } else {
        state.manual.positions.set(dragState.id, { x: nextX, y: nextY });
      }
      layoutDirty = true;
      scheduleRender();
    }
  }

  function handlePointerUp(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (refs.canvas && refs.canvas.hasPointerCapture(event.pointerId)) {
      refs.canvas.releasePointerCapture(event.pointerId);
    }
    document.body.dataset.dragging = "false";
    if (dragState.target) {
      dragState.target.classList.remove("is-active");
    }
    dragState = null;
  }

  function handleDoubleClick(event) {
    const target = event.target.closest("[data-draggable]");
    if (!target) return;
    const id = target.dataset.id;
    if (!id) return;

    if (target.dataset.floating === "true") {
      if (state.customChairs.delete(id)) {
        if (state.manual.selectedId === id) {
          state.manual.selectedId = null;
        }
        layoutDirty = true;
        scheduleRender();
      }
    } else if (state.manual.positions.has(id)) {
      state.manual.positions.delete(id);
      layoutDirty = true;
      scheduleRender();
    }
  }

  function getChairOrigin(id) {
    if (!latestLayout) return null;
    const chair = latestLayout.chairs.find((item) => item.id === id);
    return chair ? { x: chair.x, y: chair.y } : null;
  }

  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      renderPending = false;
      flushRender();
    });
  }

  function triggerLayout(option) {
    let autoCandidate = true;
    if (typeof option === "boolean") {
      autoCandidate = option;
    } else if (option && typeof option === "object") {
      autoCandidate = option.autoArrangeCandidate ?? true;
    }

    if (autoCandidate && state.flags.autoArrange) {
      state.manual.positions.clear();
      state.manual.selectedId = null;
    }

    layoutDirty = true;
    scheduleRender();
  }

  function flushRenderImmediate() {
    if (!layoutDirty) return;
    if (rafId != null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
      renderPending = false;
    }
    flushRender();
  }

  function flushRender() {
    const layout = computeLayout();
    latestLayout = layout;
    layoutDirty = false;
    draw(layout);
    updateMetrics(layout);
  }

  function computeLayout() {
    const units = state.table.unitsPerInch;
    const totalLengthPx = toPixels(totalLengthInches());
    const widthPx = toPixels(state.table.width);
    const shape = state.table.shape === "rounded" ? "rounded" : "capsule";
    const maxRadius = Math.min(totalLengthPx, widthPx) / 2;
    const cornerPx =
      shape === "capsule"
        ? Math.min(widthPx / 2, maxRadius)
        : Math.min(state.table.cornerRadius * units, maxRadius);

    const table = {
      cx: state.table.position.x,
      cy: state.table.position.y,
      width: totalLengthPx,
      height: widthPx,
      radius: cornerPx,
      shape,
      x: state.table.position.x - totalLengthPx / 2,
      y: state.table.position.y - widthPx / 2,
    };

    const seatWidthPx = toPixels(state.seating.chairWidth);
    const seatDepthPx = toPixels(state.seating.chairDepth);
    const clearancePx = toPixels(state.seating.clearance);
    const sideOffsetPx = toPixels(state.seating.sideOffset);
    const endOffsetPx = toPixels(state.seating.endOffset);

    const chairs = [];
    const autoIds = new Set();

    const sideCenters = distributeCenters(
      table.width,
      seatWidthPx,
      state.seating.sideCount,
      sideOffsetPx
    );

    sideCenters.forEach((offset, index) => {
      const id = `side-top-${index + 1}`;
      autoIds.add(id);
      const chair = {
        id,
        role: "side-top",
        rotation: 0,
        width: seatWidthPx,
        depth: seatDepthPx,
        x: table.x + offset,
        y: table.y - clearancePx - seatDepthPx / 2,
        auto: true,
        floating: false,
      };
      applyManualPosition(chair);
      chairs.push(chair);
    });

    sideCenters.forEach((offset, index) => {
      const id = `side-bottom-${index + 1}`;
      autoIds.add(id);
      const chair = {
        id,
        role: "side-bottom",
        rotation: 180,
        width: seatWidthPx,
        depth: seatDepthPx,
        x: table.x + offset,
        y: table.y + table.height + clearancePx + seatDepthPx / 2,
        auto: true,
        floating: false,
      };
      applyManualPosition(chair);
      chairs.push(chair);
    });

    const endCenters = distributeCenters(
      table.height,
      seatWidthPx,
      state.seating.endCount,
      endOffsetPx
    );

    endCenters.forEach((offset, index) => {
      const id = `end-left-${index + 1}`;
      autoIds.add(id);
      const chair = {
        id,
        role: "end-left",
        rotation: -90,
        width: seatWidthPx,
        depth: seatDepthPx,
        x: table.x - clearancePx - seatDepthPx / 2,
        y: table.y + offset,
        auto: true,
        floating: false,
      };
      applyManualPosition(chair);
      chairs.push(chair);
    });

    endCenters.forEach((offset, index) => {
      const id = `end-right-${index + 1}`;
      autoIds.add(id);
      const chair = {
        id,
        role: "end-right",
        rotation: 90,
        width: seatWidthPx,
        depth: seatDepthPx,
        x: table.x + table.width + clearancePx + seatDepthPx / 2,
        y: table.y + offset,
        auto: true,
        floating: false,
      };
      applyManualPosition(chair);
      chairs.push(chair);
    });

    pruneManualOverrides(autoIds);

    state.customChairs.forEach((value, id) => {
      chairs.push({
        id,
        role: "floating",
        rotation: value.rotation ?? 0,
        width: seatWidthPx,
        depth: seatDepthPx,
        x: value.x,
        y: value.y,
        auto: false,
        floating: true,
      });
    });

    const bounds = computeBounds(table, chairs);

    return { table, chairs, bounds };
  }

  function applyManualPosition(chair) {
    const override = state.manual.positions.get(chair.id);
    if (override) {
      chair.x = override.x;
      chair.y = override.y;
    }
  }

  function pruneManualOverrides(validIds) {
    for (const id of state.manual.positions.keys()) {
      if (!validIds.has(id)) {
        state.manual.positions.delete(id);
      }
    }
  }

  function draw(layout) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(renderTable(layout.table));
    layout.chairs.forEach((chair) => fragment.appendChild(renderChair(chair)));
    refs.contentLayer.replaceChildren(fragment);
    updateGrid(layout);
  }

  function renderTable(table) {
    const group = createSvg("g");
    group.dataset.draggable = "table";
    group.dataset.id = "table";
    group.classList.add("table-shadow");

    if (table.shape === "capsule") {
      const pathData = buildCapsulePath(table);
      const shapePath = createSvg("path");
      shapePath.classList.add("table-shape");
      shapePath.setAttribute("d", pathData);

      const outlinePath = createSvg("path");
      outlinePath.classList.add("table-outline");
      outlinePath.setAttribute("d", pathData);

      group.append(shapePath, outlinePath);
      return group;
    }

    const rect = createSvg("rect");
    rect.classList.add("table-shape");
    rect.setAttribute("x", table.x.toFixed(2));
    rect.setAttribute("y", table.y.toFixed(2));
    rect.setAttribute("width", table.width.toFixed(2));
    rect.setAttribute("height", table.height.toFixed(2));
    rect.setAttribute("rx", table.radius.toFixed(2));
    rect.setAttribute("ry", table.radius.toFixed(2));

    const outline = createSvg("rect");
    outline.classList.add("table-outline");
    outline.setAttribute("x", table.x.toFixed(2));
    outline.setAttribute("y", table.y.toFixed(2));
    outline.setAttribute("width", table.width.toFixed(2));
    outline.setAttribute("height", table.height.toFixed(2));
    outline.setAttribute("rx", table.radius.toFixed(2));
    outline.setAttribute("ry", table.radius.toFixed(2));

    group.append(rect, outline);
    return group;
  }

  function renderChair(chair) {
    const group = createSvg("g");
    group.dataset.draggable = "chair";
    group.dataset.id = chair.id;
    group.dataset.floating = chair.floating ? "true" : "false";
    group.classList.add("chair-group");
    if (chair.floating) {
      group.classList.add("is-floating");
    }
    if (state.manual.selectedId === chair.id) {
      group.classList.add("is-active");
    }

    const transform = `translate(${chair.x.toFixed(2)} ${chair.y.toFixed(2)}) rotate(${chair.rotation})`;
    group.setAttribute("transform", transform);

    if (state.manual.selectedId === chair.id) {
      const ring = createSvg("rect");
      ring.classList.add("selection-ring");
      ring.setAttribute("x", (-chair.width / 2 - 8).toFixed(2));
      ring.setAttribute("y", (-chair.depth / 2 - 8).toFixed(2));
      ring.setAttribute("width", (chair.width + 16).toFixed(2));
      ring.setAttribute("height", (chair.depth + 16).toFixed(2));
      group.appendChild(ring);
    }

    const back = createSvg("rect");
    const backHeight = Math.max(6, chair.depth * 0.24);
    const backWidth = chair.width * 0.72;
    back.classList.add("chair-back");
    back.setAttribute("x", (-backWidth / 2).toFixed(2));
    back.setAttribute("y", (-chair.depth / 2 - backHeight + 4).toFixed(2));
    back.setAttribute("width", backWidth.toFixed(2));
    back.setAttribute("height", backHeight.toFixed(2));

    const seat = createSvg("rect");
    seat.classList.add("chair-seat");
    seat.setAttribute("x", (-chair.width / 2).toFixed(2));
    seat.setAttribute("y", (-chair.depth / 2).toFixed(2));
    seat.setAttribute("width", chair.width.toFixed(2));
    seat.setAttribute("height", chair.depth.toFixed(2));

    const front = createSvg("rect");
    const frontHeight = Math.max(6, chair.depth * 0.16);
    const frontWidth = chair.width * 0.58;
    front.classList.add("chair-front");
    front.setAttribute("x", (-frontWidth / 2).toFixed(2));
    front.setAttribute("y", (chair.depth / 2 - frontHeight).toFixed(2));
    front.setAttribute("width", frontWidth.toFixed(2));
    front.setAttribute("height", frontHeight.toFixed(2));

    group.append(back, seat, front);
    return group;
  }

  function updateGrid(layout) {
    refs.gridLayer.replaceChildren();
    const bounds = layout.bounds;
    const margin = 40;
    const rect = createSvg("rect");
    rect.setAttribute("x", (bounds.minX - margin).toFixed(2));
    rect.setAttribute("y", (bounds.minY - margin).toFixed(2));
    rect.setAttribute("width", (bounds.maxX - bounds.minX + margin * 2).toFixed(2));
    rect.setAttribute("height", (bounds.maxY - bounds.minY + margin * 2).toFixed(2));
    rect.setAttribute("rx", 30);
    rect.setAttribute("ry", 30);
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "rgba(15,76,129,0.25)");
    rect.setAttribute("stroke-dasharray", "18 12");
    rect.setAttribute("stroke-width", "2");
    refs.gridLayer.appendChild(rect);
  }

  function updateMetrics(layout) {
    if (refs.totalLengthOut) {
      refs.totalLengthOut.textContent = `${formatNumber(totalLengthInches(), 1)}″`;
    }
    if (refs.seatCountOut) {
      refs.seatCountOut.textContent = String(layout.chairs.length);
    }
    if (refs.footprintOut) {
      const widthIn = (layout.bounds.maxX - layout.bounds.minX) / state.table.unitsPerInch;
      const heightIn = (layout.bounds.maxY - layout.bounds.minY) / state.table.unitsPerInch;
      refs.footprintOut.textContent = `${formatNumber(widthIn, 1)}″ × ${formatNumber(heightIn, 1)}″`;
    }
  }

  function computeBounds(table, chairs) {
    let minX = table.x;
    let maxX = table.x + table.width;
    let minY = table.y;
    let maxY = table.y + table.height;

    chairs.forEach((chair) => {
      const bounds = getChairBounds(chair);
      minX = Math.min(minX, bounds.minX);
      maxX = Math.max(maxX, bounds.maxX);
      minY = Math.min(minY, bounds.minY);
      maxY = Math.max(maxY, bounds.maxY);
    });

    return { minX, maxX, minY, maxY };
  }

  function getChairBounds(chair) {
    const angle = ((chair.rotation % 360) + 360) % 360;
    const isVertical = angle === 90 || angle === 270 || angle === -90;
    const width = isVertical ? chair.depth : chair.width;
    const height = isVertical ? chair.width : chair.depth;
    return {
      minX: chair.x - width / 2,
      maxX: chair.x + width / 2,
      minY: chair.y - height / 2,
      maxY: chair.y + height / 2,
    };
  }

  function scaleManualPositions(factor) {
    if (!Number.isFinite(factor) || factor === 1) return;
    state.manual.positions.forEach((pos) => {
      pos.x = state.table.position.x + (pos.x - state.table.position.x) * factor;
      pos.y = state.table.position.y + (pos.y - state.table.position.y) * factor;
    });
    state.customChairs.forEach((chair) => {
      chair.x = state.table.position.x + (chair.x - state.table.position.x) * factor;
      chair.y = state.table.position.y + (chair.y - state.table.position.y) * factor;
    });
  }

  function clientToCanvas(event) {
    const rect = refs.canvas.getBoundingClientRect();
    const xRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const yRatio = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    return {
      x: xRatio * CANVAS_DIM.width,
      y: yRatio * CANVAS_DIM.height,
    };
  }

  function normalizeValue(raw, el, asInt) {
    if (raw == null || Number.isNaN(raw)) return null;
    let value = raw;
    if (el) {
      if (el.min !== "" && Number.isFinite(Number(el.min))) {
        value = Math.max(value, Number(el.min));
      }
      if (el.max !== "" && Number.isFinite(Number(el.max))) {
        value = Math.min(value, Number(el.max));
      }
    }
    if (asInt) {
      value = Math.round(value);
    }
    return value;
  }

  function totalLengthInches() {
    return state.table.baseLength + state.table.leafLength * state.table.leafCount;
  }

  function toPixels(inches) {
    return inches * state.table.unitsPerInch;
  }

  function distributeCenters(total, seatWidth, count, offset) {
    if (count <= 0 || seatWidth <= 0 || total <= 0) return [];
    const clampedOffset = Math.min(offset, Math.max((total - seatWidth) / 2, 0));
    const start = clampedOffset + seatWidth / 2;
    const end = total - clampedOffset - seatWidth / 2;
    if (count === 1) {
      return [Math.max(start, Math.min(end, total / 2))];
    }
    const usable = Math.max(end - start, 0);
    const step = usable / (count - 1 || 1);
    return Array.from({ length: count }, (_, index) => start + index * step);
  }

  function buildCapsulePath(table) {
    const radius = Math.max(Math.min(table.height / 2, table.width / 2), 0);
    const left = table.x;
    const right = table.x + table.width;
    const top = table.y;
    const bottom = table.y + table.height;

    if (radius <= 0) {
      return [
        `M ${left.toFixed(2)} ${top.toFixed(2)}`,
        `H ${right.toFixed(2)}`,
        `V ${bottom.toFixed(2)}`,
        `H ${left.toFixed(2)}`,
        "Z",
      ].join(" ");
    }

    const startX = left + radius;
    const endX = right - radius;

    return [
      `M ${startX.toFixed(2)} ${top.toFixed(2)}`,
      `H ${endX.toFixed(2)}`,
      `A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${endX.toFixed(2)} ${bottom.toFixed(2)}`,
      `H ${startX.toFixed(2)}`,
      `A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${startX.toFixed(2)} ${top.toFixed(2)}`,
      "Z",
    ].join(" ");
  }

  function createSvg(tag) {
    return document.createElementNS(SVG_NS, tag);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function formatNumber(value, decimals = 2) {
    const factor = Math.pow(10, decimals);
    const rounded = Math.round(value * factor) / factor;
    if (decimals === 0) return String(Math.round(rounded));
    return Number.isInteger(rounded)
      ? String(Math.round(rounded))
      : rounded.toFixed(decimals).replace(/\.0+$/, "").replace(/\.([0-9]*?)0+$/, ".$1");
  }

  function inferDecimals(stepAttr) {
    if (!stepAttr || stepAttr === "any") return 2;
    if (!Number.isFinite(Number(stepAttr))) return 2;
    const stepString = String(stepAttr);
    const idx = stepString.indexOf(".");
    return idx === -1 ? 0 : stepString.length - idx - 1;
  }
})();
