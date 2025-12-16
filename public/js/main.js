import { UI } from "./ui.js";
import { initForms } from "./forms.js";
import { initDashboard } from "./dashboard.js";
import { API } from "./api.js";

document.addEventListener("DOMContentLoaded", () => {
  UI.initCommon();
  wireAdminEntrances();
  const page = document.body.dataset.page;

  if (page !== "landing") {
    UI.ensureAuth();
  }

  if (page === "dashboard") {
    initDashboard();
  }

  if (page) {
    initForms(page);
  }

  if (page === "landing") {
    setupLandingInteractions();
    loadHostelProfile();
    loadFloorOverview();
  }
});

const setupLandingInteractions = () => {
  const exploreButtons = document.querySelectorAll("[data-scroll]");
  exploreButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const targetId = button.dataset.scroll;
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth" });
    });
  });
};

const wireAdminEntrances = () => {
  const adminLinks = document.querySelectorAll("[data-requires-auth]");
  if (!adminLinks.length) return;

  adminLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const destination = link.getAttribute("href");
      if (!destination) return;
      event.preventDefault();
      UI.requireAuth(() => {
        window.location.href = destination;
      });
    });
  });
};

const loadHostelProfile = async () => {
  const badge = document.getElementById("heroBadge");
  const brand = document.querySelector(".brand");
  const logo = brand?.querySelector("img");
  try {
    const profile = await API.getHostelProfile();
    if (badge) {
      const name = profile.hostel_name || "Hostel";
      const location = profile.location || "Pakistan";
      badge.textContent = `${name} · ${location}`;
    }
    if (profile.logo_url && logo) {
      logo.src = profile.logo_url;
      logo.alt = `${profile.hostel_name || "Hostel"} logo`;
    }
    if (profile.hostel_name) {
      document.title = `HostelMate — ${profile.hostel_name}`;
    }
  } catch (error) {
    if (badge) {
      badge.textContent = "Pakistan-ready · Custom floors, rooms, and Wi‑Fi policies";
    }
  }
};

const loadFloorOverview = async () => {
  const grid = document.getElementById("floorGrid");
  const legend = document.getElementById("wifiLegend");
  const heroStats = document.getElementById("heroStats");
  if (!grid) return;

  try {
    const floors = await API.getFloorOverview();
    if (!floors.length) {
      grid.innerHTML = `<article class="floor-card"><header><h3>No rooms yet</h3></header><p>Add rooms from the admin panel to see floor info here.</p></article>`;
      if (legend) legend.textContent = "Add rooms to display wifi availability per floor.";
      return;
    }

    const floorCards = floors
      .map((floor) => {
        const friendlyFloor = formatFloorLabel(floor.floor);
        const typeLabel = Array.isArray(floor.room_types) && floor.room_types.length ? floor.room_types.join(" / ") : "Mixed rooms";
        const avgCapacity = floor.avg_capacity || 0;
        const capacityLabel = avgCapacity ? `${avgCapacity} beds/room avg` : "Capacity pending";
        const feeLabel = floor.avg_fee ? formatPKR(floor.avg_fee) : "Fee TBD";
        return `
          <article class="floor-card">
            <header>
              <h3>${friendlyFloor}</h3>
              <span class="wifi-pill ${floor.wifi_available ? "on" : "off"}">${floor.wifi_available ? "Wi-Fi" : "Offline"}</span>
            </header>
            <p>${typeLabel} · ${feeLabel} · ${capacityLabel}</p>
            <ul>
              <li>${floor.rooms || 0} rooms configured</li>
              <li>${floor.beds || 0} beds total</li>
              <li>${floor.vacancies ?? 0} beds open</li>
            </ul>
          </article>
        `;
      })
      .join("");
    grid.innerHTML = floorCards;

    if (legend) {
      const statements = floors
        .map((floor) => `${formatFloorLabel(floor.floor)} — ${floor.wifi_available ? "Wi‑Fi ready" : "Wi‑Fi not configured"}`)
        .join(" • ");
      legend.textContent = statements || "Add rooms to display Wi‑Fi and capacity per floor.";
    }

    if (heroStats) {
      heroStats.innerHTML = floors
        .map(
          (floor) => `
          <article class="hero-stat">
            <span>${formatFloorLabel(floor.floor)}</span>
            <strong>${(floor.room_types || ["Mixed"]).join(" / ")} · ${floor.avg_fee ? formatPKR(floor.avg_fee) : "Fee TBD"}</strong>
          </article>
        `
        )
        .join("");
    }
  } catch (error) {
    grid.innerHTML = `<article class="floor-card"><header><h3>Error</h3></header><p>${error.message}</p></article>`;
    if (legend) legend.textContent = error.message;
  }
};

const formatFloorLabel = (floor) => {
  if (floor === 0) return "Ground floor";
  if (floor === 1) return "First floor";
  if (floor === 2) return "Second floor";
  return `Floor ${floor}`;
};

const formatRoomType = (type) => {
  if (!type) return "Room";
  return type.charAt(0).toUpperCase() + type.slice(1);
};

const formatPKR = (value = 0) => `PKR ${Number(value || 0).toLocaleString("en-PK")}`;

