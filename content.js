(function () {
  const DEFAULT_SETTINGS = {
    sandboxRegex: "\\[SANDBOX\\]",
    teamRegex: "-([a-z])-",
    sandboxTeamFilter: "all",
    enabled: true
  };

  const STORAGE_KEY = "envoyerOrganizer";
  const inlineCache = {
    mode: null,
    container: null,
    wrappers: null,
    originalChildren: null
  };

  function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function stripEnvTag(name) {
    return name.replace(/^\[[^\]]+\]\s*/i, "");
  }

  function getProdGroup(name) {
    const stripped = stripEnvTag(name);
    const firstToken = stripped.split(/\s+/)[0] || "";
    const base = firstToken.split("-")[0];
    return base || "Production";
  }

  function loadState() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (data) => {
        const stored = data[STORAGE_KEY] || {};
        resolve({
          settings: Object.assign({}, DEFAULT_SETTINGS, stored.settings || {}),
          overrides: stored.overrides || {}
        });
      });
    });
  }

  function saveState(state) {
    return new Promise((resolve) => {
      chrome.storage.local.set({
        [STORAGE_KEY]: {
          settings: state.settings,
          overrides: state.overrides
        }
      }, resolve);
    });
  }

  function buildRegex(pattern) {
    try {
      return new RegExp(pattern, "i");
    } catch (err) {
      return null;
    }
  }

  function classify(service, state) {
    const override = state.overrides[service.name] || {};
    if (override.type === "sandbox" || override.type === "prod") {
      return {
        type: override.type,
        team: override.team || ""
      };
    }

    const sandboxRe = buildRegex(state.settings.sandboxRegex);
    if (sandboxRe && sandboxRe.test(service.name)) {
      let team = "";
      const teamRe = buildRegex(state.settings.teamRegex);
      if (teamRe) {
        const match = service.name.match(teamRe);
        if (match && match[1]) {
          team = match[1].toUpperCase();
        }
      }
      return { type: "sandbox", team };
    }

    return { type: "prod", team: "" };
  }

  function renderPanel(state) {
    const existing = document.getElementById("eo-panel");
    if (existing) {
      existing.remove();
    }

    const panel = document.createElement("section");
    panel.id = "eo-panel";
    panel.innerHTML = `
      <h1>Envoyer Organizer</h1>
      <div class="eo-row">
        <input id="eo-search" class="eo-grow" type="text" placeholder="Search services..." />
        <select id="eo-sandbox-team" class="eo-team-select">
          <option value="all">All teams</option>
        </select>
      </div>
      <div class="eo-row">
        <span class="eo-muted">Filters apply to service names only</span>
      </div>
      <details class="eo-settings">
        <summary>Settings</summary>
        <div class="eo-row">
          <button id="eo-disable">Disable organizer</button>
          <input id="eo-sandbox-regex" class="eo-grow" type="text" placeholder="Sandbox regex" />
          <input id="eo-team-regex" class="eo-grow" type="text" placeholder="Team regex (capture group 1)" />
        </div>
        <div id="eo-regex-error" class="eo-muted eo-regex-error eo-hidden"></div>
      </details>
    `;
    mountPanel(panel);

    const searchInput = panel.querySelector("#eo-search");
    const sandboxTeamSelect = panel.querySelector("#eo-sandbox-team");
    const disableBtn = panel.querySelector("#eo-disable");
    const sandboxInput = panel.querySelector("#eo-sandbox-regex");
    const teamInput = panel.querySelector("#eo-team-regex");
    const regexError = panel.querySelector("#eo-regex-error");

    sandboxInput.value = state.settings.sandboxRegex;
    teamInput.value = state.settings.teamRegex;
    sandboxTeamSelect.value = state.settings.sandboxTeamFilter || "all";

    function applySettings() {
      const sandboxRe = buildRegex(sandboxInput.value);
      const teamRe = buildRegex(teamInput.value);

      if (!sandboxRe || !teamRe) {
        regexError.textContent = !sandboxRe
          ? "Invalid sandbox regex."
          : "Invalid team regex.";
        regexError.classList.remove("eo-hidden");
        return;
      }

      regexError.classList.add("eo-hidden");
      state.settings.sandboxRegex = sandboxInput.value;
      state.settings.teamRegex = teamInput.value;
      saveState(state);
      drawLists();
    }

    sandboxInput.addEventListener("change", applySettings);
    teamInput.addEventListener("change", applySettings);

    searchInput.addEventListener("input", () => {
      drawLists();
    });

    sandboxTeamSelect.addEventListener("change", () => {
      state.settings.sandboxTeamFilter = sandboxTeamSelect.value || "all";
      saveState(state);
      drawLists();
    });

    disableBtn.addEventListener("click", () => {
      state.settings.enabled = false;
      saveState(state);
      applyEnabledState(state);
    });

    function drawLists() {
      if (!state.settings.enabled) {
        return;
      }
      drawListsForState(state);
    }

    applyEnabledState(state);
  }

  function captureOriginalContainer() {
    if (inlineCache.container) {
      return;
    }
    const grid = document.querySelector("#website-status-card .grid");
    if (grid) {
      inlineCache.mode = "card";
      inlineCache.container = grid;
      inlineCache.wrappers = Array.from(grid.querySelectorAll(".g-col-6"));
      inlineCache.originalChildren = Array.from(grid.children);
      return;
    }
    const listRoot = document.querySelector("#website-status-card .rounded-4.shadow");
    if (listRoot) {
      inlineCache.mode = "list";
      inlineCache.container = listRoot;
      inlineCache.wrappers = Array.from(listRoot.querySelectorAll(":scope > .border-bottom"));
      inlineCache.originalChildren = Array.from(listRoot.children);
    }
  }

  function collectInlineServices() {
    captureOriginalContainer();
    if (!inlineCache.container || !inlineCache.wrappers) {
      return [];
    }
    return inlineCache.wrappers.map((wrapper) => {
      const heading = wrapper.querySelector(".project-card a[href^='/projects/'] > h2");
      const link = heading ? heading.closest("a[href^='/projects/']") : null;
      if (!link) {
        return null;
      }
      const href = link.getAttribute("href") || "";
      const name = normalizeText(heading ? heading.textContent : link.textContent);
      return { name, href, wrapper };
    }).filter(Boolean);
  }

  function makeAccordionRoot(title, count) {
    const details = document.createElement("details");
    details.className = "eo-accordion-root";
    details.open = true;
    const summary = document.createElement("summary");
    summary.className = "eo-summary-card";
    const header = document.createElement("div");
    header.className = "eo-section-title";
    header.innerHTML = `<h2>${title}</h2><span class="eo-count">${count}</span>`;
    summary.appendChild(header);
    details.appendChild(summary);
    return details;
  }

  function renderInlineDashboard(prodItems, sandboxItems) {
    captureOriginalContainer();
    if (!inlineCache.container) {
      return;
    }

    const container = inlineCache.container;
    const mode = inlineCache.mode;

    container.innerHTML = "";

    if (mode === "card") {
      container.classList.add("eo-inline-grid");
      const root = document.createElement("div");
      root.className = "eo-inline-root";
      if (prodItems.length) {
        const prodDetails = makeAccordionRoot("Production", prodItems.length);
        prodDetails.appendChild(renderInlineGroupedGrid(prodItems, (item) => getProdGroup(item.svc.name)));
        root.appendChild(prodDetails);
      }
      root.appendChild(renderInlineSandboxSection(sandboxItems));
      container.appendChild(root);
    } else {
      if (prodItems.length) {
        const prodDetails = makeAccordionRoot("Production", prodItems.length);
        prodDetails.appendChild(renderInlineGroupedGrid(prodItems, (item) => getProdGroup(item.svc.name)));
        container.appendChild(prodDetails);
      }
      container.appendChild(renderInlineSandboxSection(sandboxItems));
    }
  }

  function renderInlineSandboxSection(items) {
    const details = makeAccordionRoot("Sandbox", items.length);
    details.appendChild(renderInlineAccordion(items, (item) => item.meta.team || "Unassigned"));
    return details;
  }

  function renderInlineAccordion(items, groupFn) {
    const mode = inlineCache.mode;
    const grouped = {};
    items.forEach((item) => {
      const key = groupFn(item) || "";
      grouped[key] = grouped[key] || [];
      grouped[key].push(item);
    });

    const accordion = document.createElement("div");
    accordion.className = "eo-accordion";

    Object.keys(grouped).sort().forEach((group) => {
      const details = document.createElement("details");
      details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = `${group} (${grouped[group].length})`;
      details.appendChild(summary);

      if (mode === "card") {
        const groupGrid = document.createElement("div");
        groupGrid.className = "grid";
        grouped[group].forEach(({ svc }) => {
          if (svc.wrapper) groupGrid.appendChild(svc.wrapper);
        });
        details.appendChild(groupGrid);
      } else {
        grouped[group].forEach(({ svc }) => {
          if (svc.wrapper) details.appendChild(svc.wrapper);
        });
      }

      accordion.appendChild(details);
    });

    return accordion;
  }

  function renderInlineGroupedGrid(items, groupFn) {
    const mode = inlineCache.mode;
    const grouped = {};
    items.forEach((item) => {
      const key = groupFn(item) || "";
      grouped[key] = grouped[key] || [];
      grouped[key].push(item);
    });

    const container = document.createElement("div");
    container.className = "eo-grouped";

    Object.keys(grouped).sort().forEach((group) => {
      const block = document.createElement("div");
      block.className = "eo-group-block";
      const header = document.createElement("div");
      header.className = "eo-group-title";
      header.textContent = `${group} (${grouped[group].length})`;

      if (mode === "card") {
        const groupGrid = document.createElement("div");
        groupGrid.className = "grid eo-group-body";
        grouped[group].forEach(({ svc }) => {
          if (svc.wrapper) groupGrid.appendChild(svc.wrapper);
        });
        block.appendChild(header);
        block.appendChild(groupGrid);
      } else {
        const groupBody = document.createElement("div");
        groupBody.className = "eo-group-body";
        grouped[group].forEach(({ svc }) => {
          if (svc.wrapper) groupBody.appendChild(svc.wrapper);
        });
        block.appendChild(header);
        block.appendChild(groupBody);
      }

      container.appendChild(block);
    });

    return container;
  }

  function restoreOriginalContainer() {
    captureOriginalContainer();
    if (!inlineCache.container || !inlineCache.originalChildren) {
      return;
    }
    const container = inlineCache.container;
    if (inlineCache.mode === "card") {
      container.classList.remove("eo-inline-grid");
    }
    container.innerHTML = "";
    inlineCache.originalChildren.forEach((child) => {
      container.appendChild(child);
    });
  }

  function mountPanel(panel) {
    panel.classList.add("eo-inline");
    const dashboard = document.querySelector("#website-status-card");
    const container = dashboard ? dashboard.closest(".container") : document.querySelector(".container");
    if (container) {
      if (container.firstChild) {
        container.insertBefore(panel, container.firstChild);
      } else {
        container.appendChild(panel);
      }
      return;
    }

    document.body.appendChild(panel);
  }

  function mountFloatingToggle(state) {
    const existing = document.getElementById("eo-float-toggle");
    if (existing) {
      existing.remove();
    }
    const btn = document.createElement("button");
    btn.id = "eo-float-toggle";
    btn.type = "button";
    btn.textContent = "Enable organizer";
    btn.addEventListener("click", () => {
      state.settings.enabled = true;
      saveState(state);
      applyEnabledState(state);
    });
    if (state.settings.enabled) {
      btn.classList.add("eo-hidden");
    }
    document.body.appendChild(btn);
  }

  function applyEnabledState(state) {
    const panel = document.getElementById("eo-panel");
    const floatBtn = document.getElementById("eo-float-toggle");

    if (!state.settings.enabled) {
      restoreOriginalContainer();
      if (panel) {
        panel.classList.add("eo-hidden");
      }
      if (floatBtn) {
        floatBtn.classList.remove("eo-hidden");
      }
      return;
    }

    if (panel) {
      panel.classList.remove("eo-hidden");
    }
    if (floatBtn) {
      floatBtn.classList.add("eo-hidden");
    }
    drawListsForState(state);
  }

  function drawListsForState(state) {
    if (!state.settings.enabled) {
      restoreOriginalContainer();
      return;
    }
    const panel = document.getElementById("eo-panel");
    if (!panel) {
      return;
    }
    const searchInput = panel.querySelector("#eo-search");
    const sandboxTeamSelect = panel.querySelector("#eo-sandbox-team");

    const search = normalizeText(searchInput.value || "").toLowerCase();

    const sourceServices = collectInlineServices();
    const filtered = sourceServices.filter((svc) => {
      if (search && !svc.name.toLowerCase().includes(search)) {
        return false;
      }
      return true;
    });

    const prod = [];
    const sandbox = [];
    const sandboxCandidates = [];

    filtered.forEach((svc) => {
      const meta = classify(svc, state);
      if (meta.type === "sandbox") {
        sandboxCandidates.push({ svc, meta });
      } else {
        prod.push({ svc, meta });
      }
    });

    updateSandboxTeamOptionsForState(sandboxCandidates, sandboxTeamSelect, state);
    const teamFilter = state.settings.sandboxTeamFilter || "all";
    const showProduction = teamFilter === "all" || teamFilter === "Production";

    sandboxCandidates.forEach(({ svc, meta }) => {
      if (teamFilter !== "all") {
        const teamName = meta.team || "Unassigned";
        if (teamName !== teamFilter) {
          return;
        }
      }
      sandbox.push({ svc, meta });
    });

    renderInlineDashboard(showProduction ? prod : [], sandbox);
  }

  function updateSandboxTeamOptionsForState(items, selectEl, state) {
    const teams = new Set();
    items.forEach(({ meta }) => {
      teams.add(meta.team || "Unassigned");
    });

    const sortedTeams = Array.from(teams).sort();
    const current = selectEl.value || state.settings.sandboxTeamFilter || "all";

    selectEl.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All teams";
    selectEl.appendChild(allOption);

    const prodOption = document.createElement("option");
    prodOption.value = "Production";
    prodOption.textContent = "Production";
    selectEl.appendChild(prodOption);

    sortedTeams.forEach((team) => {
      const option = document.createElement("option");
      option.value = team;
      option.textContent = team;
      selectEl.appendChild(option);
    });

    if (current !== "all" && current !== "Production" && !teams.has(current)) {
      selectEl.value = "all";
      state.settings.sandboxTeamFilter = "all";
      saveState(state);
    } else {
      selectEl.value = current;
    }
  }

  function waitForElement(selector, timeoutMs) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs || 8000);
    });
  }

  function init() {
    if (window.location.pathname !== "/dashboard") {
      return;
    }
    loadState().then((state) => {
      const waitTarget = "#website-status-card .grid, #website-status-card .rounded-4.shadow";
      return waitForElement(waitTarget, 8000).then(() => {
        renderPanel(state);
        mountFloatingToggle(state);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
