import { API } from "./api.js";

const STORAGE_KEYS = {
  theme: "hostelmate:theme",
  auth: "hostelmate:auth"
};

const ADMIN_CREDENTIALS = {
  id: "admin@hostelmate.app",
  password: "staysecure@2025"
};
const BRAND = {
  name: "HostelMate",
  initials: "HM"
};

const prefersDark = () => window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
const debounce = (fn, delay = 300) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

const UI = (() => {
  const state = {
    sidebarOpen: false,
    searchOpen: false,
    pendingAuthAction: null
  };

  const elements = {
    sidebar: null,
    sidebarToggle: null,
    themeToggle: null,
    toastContainer: null,
    preloader: null,
    modal: null,
    modalMessage: null,
    modalConfirm: null,
    modalCancel: null,
    globalSearchInputs: null,
    searchPanel: null,
    searchResults: null,
    userMenu: null,
    avatarBtn: null,
    authGate: null,
    authForm: null
  };

  const initCommon = () => {
    cacheDom();
    mountDynamicUi();
    bindEvents();
    syncTheme();
    setActiveNav();
    window.setTimeout(hidePreloader, 300);
  };

  const cacheDom = () => {
    elements.sidebar = document.querySelector(".sidebar");
    elements.sidebarToggle = document.querySelector("[data-action='toggle-sidebar']");
    elements.themeToggle = document.querySelector("[data-action='toggle-theme']");
    elements.toastContainer = document.getElementById("toast-container");
    elements.preloader = document.getElementById("preloader");
    elements.modal = document.getElementById("modal");
    elements.modalMessage = document.getElementById("modal-message");
    elements.modalConfirm = document.getElementById("modal-confirm");
    elements.modalCancel = document.getElementById("modal-cancel");
  };

  const mountDynamicUi = () => {
    mountUserMenu();
    mountSearchPanel();
    mountAuthGate();
  };

  const bindEvents = () => {
    if (elements.sidebarToggle) {
      elements.sidebarToggle.addEventListener("click", toggleSidebar);
    }
    if (elements.themeToggle) {
      elements.themeToggle.addEventListener("click", toggleTheme);
    }
    if (elements.avatarBtn) {
      elements.avatarBtn.addEventListener("click", toggleUserMenu);
    }
    if (elements.userMenu) {
      elements.userMenu.addEventListener("click", handleUserMenuClick);
    }
    setupGlobalSearch();
    setupSearchShortcuts();
    setupAuthHandlers();

    document.addEventListener("click", (event) => {
      if (!elements.userMenu) return;
      if (!elements.userMenu.contains(event.target) && event.target !== elements.avatarBtn) {
        elements.userMenu.classList.remove("visible");
      }
      if (elements.searchPanel && !elements.searchPanel.contains(event.target) && !event.target.classList?.contains("global-search")) {
        toggleSearchPanel(false);
      }
    });

    window.addEventListener("show-toast", (event) => {
      const { message, type } = event.detail || {};
      toast(message || "Notification", type || "success");
    });
  };

  const toggleSidebar = () => {
    state.sidebarOpen = !state.sidebarOpen;
    elements.sidebar?.classList.toggle("open", state.sidebarOpen);
  };

  const syncTheme = () => {
    const stored = localStorage.getItem(STORAGE_KEYS.theme);
    const theme = stored || (prefersDark() ? "dark" : "light");
    document.body.dataset.theme = theme === "dark" ? "dark" : "light";
  };

  const toggleTheme = () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = next;
    localStorage.setItem(STORAGE_KEYS.theme, next);
  };

  const hidePreloader = () => {
    if (elements.preloader) {
      elements.preloader.classList.add("hidden");
    }
  };

  const setActiveNav = () => {
    const page = document.body.dataset.page;
    if (!page) return;
    document.querySelectorAll("[data-nav]").forEach((link) => {
      link.classList.toggle("active", link.dataset.nav === page);
    });
  };

  const toast = (message, type = "success") => {
    if (!elements.toastContainer) {
      const container = document.createElement("div");
      container.id = "toast-container";
      container.className = "toast-container";
      document.body.appendChild(container);
      elements.toastContainer = container;
    }

    const toastEl = document.createElement("div");
    toastEl.className = `toast ${type}`;
    toastEl.innerHTML = `
      <span>${message}</span>
      <button aria-label="Dismiss">&times;</button>
    `;
    toastEl.querySelector("button").addEventListener("click", () => toastEl.remove());
    elements.toastContainer.appendChild(toastEl);

    setTimeout(() => toastEl.remove(), 4500);
  };

  const confirm = (message) => {
    if (!elements.modal || !elements.modalMessage) {
      const fallback = window.confirm(message);
      return Promise.resolve(fallback);
    }

    return new Promise((resolve) => {
      elements.modal.classList.add("visible");
      elements.modalMessage.textContent = message;

      const cleanup = (result) => {
        elements.modal.classList.remove("visible");
        elements.modalConfirm?.removeEventListener("click", onConfirm);
        elements.modalCancel?.removeEventListener("click", onCancel);
        resolve(result);
      };

      const onConfirm = () => cleanup(true);
      const onCancel = () => cleanup(false);

      elements.modalConfirm?.addEventListener("click", onConfirm, { once: true });
      elements.modalCancel?.addEventListener("click", onCancel, { once: true });
    });
  };

  const setOptions = (select, options = [], formatOption = (item) => ({
    label: item.label ?? item.name ?? item.title ?? "Option",
    value: item.value ?? item.id ?? item.student_id ?? item.room_id
  })) => {
    if (!select) return;
    select.innerHTML = "";
    if (!options.length) {
      const empty = document.createElement("option");
      empty.textContent = "No records found";
      empty.value = "";
      select.appendChild(empty);
      return;
    }

    options.forEach((item) => {
      const { label, value } = formatOption(item);
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
  };

  const setLoading = (element, isLoading, label = "Processing...") => {
    if (!element) return;
    element.dataset.originalText = element.dataset.originalText || element.textContent;
    element.disabled = isLoading;
    element.textContent = isLoading ? label : element.dataset.originalText;
  };
  const mountUserMenu = () => {
    const actions = document.querySelector(".topbar-actions");
    if (!actions || actions.querySelector(".avatar")) return;
    const avatarBtn = document.createElement("button");
    avatarBtn.type = "button";
    avatarBtn.className = "avatar";
    avatarBtn.textContent = BRAND.initials;
    actions.style.position = "relative";
    actions.appendChild(avatarBtn);

    const menu = document.createElement("div");
    menu.id = "userMenu";
    menu.className = "user-menu";
    menu.innerHTML = `
      <button type="button" data-user="profile">Workspace profile</button>
      <button type="button" data-user="logout">Logout</button>
    `;
    actions.appendChild(menu);

    elements.avatarBtn = avatarBtn;
    elements.userMenu = menu;
  };

  const toggleUserMenu = () => {
    elements.userMenu?.classList.toggle("visible");
  };

  const handleUserMenuClick = (event) => {
    const action = event.target?.dataset?.user;
    if (action === "logout") {
      localStorage.removeItem(STORAGE_KEYS.auth);
      toast("Session cleared. Please login again.", "success");
      showAuthGate();
    }
    if (action === "profile") {
      toast(`Admin: ${ADMIN_CREDENTIALS.id}`, "success");
    }
    elements.userMenu.classList.remove("visible");
  };

  const mountSearchPanel = () => {
    if (document.getElementById("search-panel")) {
      elements.searchPanel = document.getElementById("search-panel");
      elements.searchResults = elements.searchPanel.querySelector("ul");
      return;
    }
    const panel = document.createElement("div");
    panel.id = "search-panel";
    panel.className = "search-panel";
    panel.innerHTML = `
      <ul id="search-results"></ul>
    `;
    document.body.appendChild(panel);
    elements.searchPanel = panel;
    elements.searchResults = panel.querySelector("#search-results");
  };

  const setupGlobalSearch = () => {
    elements.globalSearchInputs = document.querySelectorAll(".global-search");
    if (!elements.globalSearchInputs.length) return;

    const performSearch = debounce(async (term) => {
      if (!term || term.length < 2) {
        renderSearchResults([]);
        return;
      }
      try {
        const [students, rooms] = await Promise.all([
          API.getStudents({ search: term, order: "asc", sortBy: "name" }),
          API.getRooms()
        ]);
        const filteredRooms = rooms.filter((room) => room.room_number?.toLowerCase().includes(term.toLowerCase())).slice(0, 4);
        renderSearchResults([
          ...students.slice(0, 5).map((student) => ({
            type: "student",
            title: student.name,
            subtitle: `${student.department ?? "•••"} • CNIC ${student.cnic}`,
            href: `edit-student.html?id=${student.student_id}`
          })),
          ...filteredRooms.map((room) => ({
            type: "room",
            title: `Room ${room.room_number}`,
            subtitle: `${room.room_type ?? "room"} • floor ${room.floor_level ?? 0} • ${room.capacity - room.current_occupancy} open • ${room.monthly_fee ? `fee ${Number(room.monthly_fee).toLocaleString("en-PK")} PKR` : "fee TBD"}`,
            href: `rooms.html#room-${room.room_id}`
          }))
        ]);
        toggleSearchPanel(true);
      } catch (error) {
        toast(error.message, "error");
      }
    }, 300);

    elements.globalSearchInputs.forEach((input) => {
      input.removeAttribute("disabled");
      input.addEventListener("input", (event) => {
        const term = event.target.value.trim();
        toggleSearchPanel(true);
        performSearch(term);
      });
      input.addEventListener("focus", () => {
        toggleSearchPanel(true);
        renderSearchResults([]);
      });
    });
  };

  const setupSearchShortcuts = () => {
    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        elements.globalSearchInputs?.[0]?.focus();
        toggleSearchPanel(true);
      }
      if (event.key === "Escape") {
        toggleSearchPanel(false);
      }
    });
  };

  const toggleSearchPanel = (show) => {
    if (!elements.searchPanel) return;
    state.searchOpen = show;
    elements.searchPanel.classList.toggle("visible", show);
  };

  const renderSearchResults = (items) => {
    if (!elements.searchResults) return;
    if (!items.length) {
      elements.searchResults.innerHTML = `<li class="result-meta">Type at least 2 characters to search students or rooms.</li>`;
      return;
    }
    elements.searchResults.innerHTML = items
      .map(
        (item) => `
      <li data-href="${item.href}">
        <strong>${item.title}</strong>
        <div class="result-meta">${item.type === "student" ? "Student" : "Room"} • ${item.subtitle}</div>
      </li>
    `
      )
      .join("");

    elements.searchResults.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", () => {
        const destination = li.dataset.href;
        if (destination) {
          window.location.href = destination;
        }
      });
    });
  };

  const mountAuthGate = () => {
    if (document.getElementById("authGate")) {
      elements.authGate = document.getElementById("authGate");
      elements.authForm = document.getElementById("authForm");
      return;
    }
    const gate = document.createElement("div");
    gate.id = "authGate";
    gate.className = "auth-gate";
    gate.innerHTML = `
      <div class="auth-card">
        <h3>Admin access</h3>
        <p>Enter your admin ID and password to continue.</p>
        <form id="authForm">
          <div class="form-control">
            <label for="adminId">Admin ID</label>
            <input id="adminId" name="adminId" type="text" placeholder="admin@hostelmate.app" autocomplete="username" required />
          </div>
          <div class="form-control">
            <label for="adminPassword">Password</label>
            <input id="adminPassword" name="adminPassword" type="password" placeholder="••••••" autocomplete="current-password" required />
          </div>
          <button class="btn btn-primary" type="submit">Unlock workspace</button>
        </form>
      </div>
    `;
    document.body.appendChild(gate);
    elements.authGate = gate;
    elements.authForm = gate.querySelector("#authForm");
  };

  const setupAuthHandlers = () => {
    if (!elements.authForm) return;
    elements.authForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(elements.authForm);
      const adminId = String(form.get("adminId") || "").trim().toLowerCase();
      const password = String(form.get("adminPassword") || "").trim();
      const idMatch = adminId === ADMIN_CREDENTIALS.id.toLowerCase();
      const passwordMatch = password === ADMIN_CREDENTIALS.password;
      if (idMatch && passwordMatch) {
        localStorage.setItem(STORAGE_KEYS.auth, "granted");
        hideAuthGate();
        toast("Welcome back, administrator", "success");
        const action = state.pendingAuthAction;
        state.pendingAuthAction = null;
        if (typeof action === "function") {
          action();
        }
      } else {
        toast("Invalid admin ID or password", "error");
      }
      elements.authForm.reset();
    });
  };

  const ensureAuth = () => {
    if (document.body.dataset.page === "landing") return;
    if (localStorage.getItem(STORAGE_KEYS.auth)) {
      hideAuthGate();
    } else {
      showAuthGate();
    }
  };

  const showAuthGate = () => {
    elements.authGate?.classList.add("visible");
    elements.authGate?.querySelector("input")?.focus();
  };

  const hideAuthGate = () => {
    elements.authGate?.classList.remove("visible");
  };

  const requireAuth = (onSuccess) => {
    if (localStorage.getItem(STORAGE_KEYS.auth)) {
      if (typeof onSuccess === "function") onSuccess();
      return;
    }
    state.pendingAuthAction = typeof onSuccess === "function" ? onSuccess : null;
    showAuthGate();
  };

  return {
    initCommon,
    ensureAuth,
    requireAuth,
    toast,
    confirm,
    setOptions,
    setLoading
  };
})();

export { UI };

