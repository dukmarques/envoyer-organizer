(function () {
  const DEFAULT_SETTINGS = {
    sandboxRegex: "\\[SANDBOX\\]",
    teamRegex: "-([a-z])-",
    groupSandbox: true,
    sandboxTeamFilter: "all",
    enabled: true
  };

  const STORAGE_KEY = "envoyerOrganizer";
  const inlineCache = {
    grid: null,
    wrappers: null,
    originalChildren: null
  };

  function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function escapeHtml(str) {
    return str.replace(/[&<>\"']/g, (ch) => {
      switch (ch) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case "\"":
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return ch;
      }
    });
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

  function collectServices() {
    const items = [];
    const seen = new Set();

    function addItem(name, href) {
      const cleanName = normalizeText(name || "");
      if (!cleanName || cleanName.length < 3 || !href) {
        return;
      }

      const key = `${cleanName}::${href}`;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      items.push({ name: cleanName, href });
    }

    const cardHeadings = Array.from(
      document.querySelectorAll(".project-card a[href^='/projects/'] > h2")
    );

    cardHeadings.forEach((heading) => {
      const link = heading.closest("a[href^='/projects/']");
      if (!link) {
        return;
      }
      const name = heading.textContent;
      const href = link.getAttribute("href") || "";
      addItem(name, href);
    });

    const dropdownLinks = Array.from(
      document.querySelectorAll(".dropdown-menu a.dropdown-item[href^='/projects/']")
    );

    dropdownLinks.forEach((link) => {
      addItem(link.textContent, link.getAttribute("href") || "");
    });

    return items;
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

  function renderPanel(state, services) {
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
      <div class="eo-section" id="eo-prod"></div>
      <div class="eo-section" id="eo-sandbox"></div>
      <details class="eo-settings">
        <summary>Settings</summary>
        <div class="eo-row">
          <button id="eo-disable">Disable organizer</button>
          <input id="eo-sandbox-regex" class="eo-grow" type="text" placeholder="Sandbox regex" />
          <input id="eo-team-regex" class="eo-grow" type="text" placeholder="Team regex (capture group 1)" />
        </div>
      </details>
    `;
    mountPanel(panel);

    const searchInput = panel.querySelector("#eo-search");
    const sandboxTeamSelect = panel.querySelector("#eo-sandbox-team");
    const disableBtn = panel.querySelector("#eo-disable");
    const sandboxInput = panel.querySelector("#eo-sandbox-regex");
    const teamInput = panel.querySelector("#eo-team-regex");

    sandboxInput.value = state.settings.sandboxRegex;
    teamInput.value = state.settings.teamRegex;
    sandboxTeamSelect.value = state.settings.sandboxTeamFilter || "all";

    function applySettings() {
      const sandboxRe = buildRegex(sandboxInput.value);
      const teamRe = buildRegex(teamInput.value);

      if (!sandboxRe || !teamRe) {
        return;
      }

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
      applyEnabledState(state, services);
    });

    function drawLists() {
      if (!state.settings.enabled) {
        return;
      }
      drawListsForState(state, services);
    }

    function renderSection(title, items, state) {
      const container = document.createElement("div");
      container.innerHTML = `
        <div class="eo-section-title">
          <h2>${escapeHtml(title)}</h2>
          <span class="eo-count">${items.length}</span>
        </div>
      `;

      items.forEach(({ svc, meta }) => {
        container.appendChild(renderItem(svc, meta, state));
      });

      return container;
    }

    function renderProductionSection(items, state) {
      const container = document.createElement("details");
      container.className = "eo-accordion-root";
      container.open = true;
      const summary = document.createElement("summary");
      summary.className = "eo-summary-card";
      const header = document.createElement("div");
      header.className = "eo-section-title";
      header.innerHTML = `
        <h2>Production</h2>
        <span class="eo-count">${items.length}</span>
      `;
      summary.appendChild(header);
      container.appendChild(summary);
      container.appendChild(renderGroupedList(items, (item) => getProdGroup(item.svc.name), state));
      return container;
    }

    function renderSandboxSection(items, state) {
      const container = document.createElement("details");
      container.className = "eo-accordion-root";
      container.open = true;
      const summary = document.createElement("summary");
      summary.className = "eo-summary-card";
      const header = document.createElement("div");
      header.className = "eo-section-title";
      header.innerHTML = `
        <h2>Sandbox</h2>
        <span class="eo-count">${items.length}</span>
      `;
      summary.appendChild(header);
      container.appendChild(summary);

      const grouped = {};
      items.forEach(({ svc, meta }) => {
        const team = meta.team || "Unassigned";
        grouped[team] = grouped[team] || [];
        grouped[team].push({ svc, meta });
      });

      const accordion = document.createElement("div");
      accordion.className = "eo-accordion";

      Object.keys(grouped).sort().forEach((team) => {
        const details = document.createElement("details");
        details.open = true;
        const summary = document.createElement("summary");
        summary.textContent = `${team} (${grouped[team].length})`;
        details.appendChild(summary);
        grouped[team].forEach(({ svc, meta }) => {
          details.appendChild(renderItem(svc, meta, state));
        });
        accordion.appendChild(details);
      });

      container.appendChild(accordion);
      return container;
    }

    function renderItem(service, meta, state) {
      const item = document.createElement("div");
      item.className = "eo-item";

      const link = document.createElement("a");
      link.href = service.href;
      link.textContent = service.name;

      const tag = document.createElement("span");
      tag.className = "eo-tag";
      tag.textContent = meta.type === "sandbox" ? "Sandbox" : "Prod";
      if (meta.team) {
        tag.textContent += `:${meta.team}`;
      }

      tag.addEventListener("click", () => {
        const current = state.overrides[service.name] || {};
        const nextType = meta.type === "sandbox" ? "prod" : "sandbox";
        state.overrides[service.name] = Object.assign({}, current, {
          type: nextType
        });
        saveState(state);
        drawLists();
      });

      item.appendChild(link);
      item.appendChild(tag);
      return item;
    }

    applyEnabledState(state, services);
  }

  function updateOriginalListVisibility(hide) {
    const containers = Array.from(document.querySelectorAll("main, .container, #app"));
    containers.forEach((el) => {
      if (!el.dataset.eoOriginal) {
        el.dataset.eoOriginal = "true";
      }
      if (hide) {
        el.classList.add("eo-hidden");
      } else {
        el.classList.remove("eo-hidden");
      }
    });
  }

  function captureOriginalGrid() {
    if (inlineCache.grid) {
      return;
    }
    const grid = document.querySelector("#website-status-card .grid");
    if (!grid) {
      return;
    }
    inlineCache.grid = grid;
    inlineCache.wrappers = Array.from(grid.querySelectorAll(".g-col-6"));
    inlineCache.originalChildren = Array.from(grid.children);
  }

  function collectInlineServices() {
    captureOriginalGrid();
    if (!inlineCache.wrappers) {
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

  function renderInlineDashboard(prodItems, sandboxItems) {
    captureOriginalGrid();
    if (!inlineCache.grid) {
      return;
    }

    const grid = inlineCache.grid;

    grid.classList.add("eo-inline-grid");
    grid.innerHTML = "";

    const root = document.createElement("div");
    root.className = "eo-inline-root";
    if (prodItems.length) {
      const prodDetails = document.createElement("details");
      prodDetails.className = "eo-accordion-root";
      prodDetails.open = true;
      const prodSummary = document.createElement("summary");
      prodSummary.className = "eo-summary-card";
      const prodHeader = document.createElement("div");
      prodHeader.className = "eo-section-title";
      prodHeader.innerHTML = `
        <h2>Production</h2>
        <span class="eo-count">${prodItems.length}</span>
      `;
      prodSummary.appendChild(prodHeader);
      prodDetails.appendChild(prodSummary);
      prodDetails.appendChild(renderInlineGroupedGrid(prodItems, (item) => getProdGroup(item.svc.name)));
      root.appendChild(prodDetails);
    }

    root.appendChild(renderInlineSandboxSection(sandboxItems));
    grid.appendChild(root);
  }

  function renderInlineSandboxSection(items) {
    const container = document.createElement("details");
    container.className = "eo-accordion-root";
    container.open = true;
    const summary = document.createElement("summary");
    summary.className = "eo-summary-card";
    const header = document.createElement("div");
    header.className = "eo-section-title";
    header.innerHTML = `
      <h2>Sandbox</h2>
      <span class="eo-count">${items.length}</span>
    `;
    summary.appendChild(header);
    container.appendChild(summary);
    container.appendChild(renderInlineAccordion(items, (item) => item.meta.team || "Unassigned"));
    return container;
  }

  function renderInlineGroup(title, items, groupFn) {
    const container = document.createElement("div");
    const header = document.createElement("div");
    header.className = "eo-section-title";
    header.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      <span class="eo-count">${items.length}</span>
    `;
    container.appendChild(header);
    container.appendChild(renderInlineAccordion(items, groupFn));
    return container;
  }

  function renderInlineAccordion(items, groupFn) {
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

      const groupGrid = document.createElement("div");
      groupGrid.className = "grid";

      grouped[group].forEach(({ svc }) => {
        if (svc.wrapper) {
          groupGrid.appendChild(svc.wrapper);
        }
      });

      details.appendChild(groupGrid);
      accordion.appendChild(details);
    });

    return accordion;
  }

  function renderInlineGroupedGrid(items, groupFn) {
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
      const groupGrid = document.createElement("div");
      groupGrid.className = "grid eo-group-body";

      grouped[group].forEach(({ svc }) => {
        if (svc.wrapper) {
          groupGrid.appendChild(svc.wrapper);
        }
      });

      block.appendChild(header);
      block.appendChild(groupGrid);
      container.appendChild(block);
    });

    return container;
  }

  function renderGroupedList(items, groupFn, state) {
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
      const body = document.createElement("div");
      body.className = "eo-group-body";

      grouped[group].forEach(({ svc, meta }) => {
        body.appendChild(renderItem(svc, meta, state));
      });

      block.appendChild(header);
      block.appendChild(body);
      container.appendChild(block);
    });

    return container;
  }

  function restoreOriginalGrid() {
    captureOriginalGrid();
    if (!inlineCache.grid || !inlineCache.originalChildren) {
      return;
    }
    const grid = inlineCache.grid;
    grid.classList.remove("eo-inline-grid");
    grid.innerHTML = "";
    inlineCache.originalChildren.forEach((child) => {
      grid.appendChild(child);
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

  function mountFloatingToggle(state, services) {
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
      applyEnabledState(state, services);
    });
    if (state.settings.enabled) {
      btn.classList.add("eo-hidden");
    }
    document.body.appendChild(btn);
  }

  function applyEnabledState(state, services) {
    const panel = document.getElementById("eo-panel");
    const floatBtn = document.getElementById("eo-float-toggle");

    if (!state.settings.enabled) {
      restoreOriginalGrid();
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
    drawListsForState(state, services);
  }

  function drawListsForState(state, services) {
    if (!state.settings.enabled) {
      restoreOriginalGrid();
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
      const waitTarget = "#website-status-card .grid";
      return waitForElement(waitTarget, 8000).then(() => {
        const services = collectServices();
        renderPanel(state, services);
        mountFloatingToggle(state, services);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
