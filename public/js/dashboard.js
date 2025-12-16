import { API } from "./api.js";
import { UI } from "./ui.js";

const formatPKR = (value = 0) => `PKR ${Number(value || 0).toLocaleString("en-PK")}`;

const initDashboard = async () => {
  await loadMetrics();
  await loadAllocationsSnapshot();
};

const loadMetrics = async () => {
  const metricEls = {
    totalStudents: document.getElementById("metricStudents"),
    totalRooms: document.getElementById("metricRooms"),
    totalAllocations: document.getElementById("metricAllocations"),
    vacantRooms: document.getElementById("metricVacant"),
    pendingComplaints: document.getElementById("metricComplaints"),
    totalPayments: document.getElementById("metricPayments")
  };
  const insightEls = {
    beds: document.getElementById("insightBeds"),
    vacantRooms: document.getElementById("insightVacantRooms"),
    complaints: document.getElementById("insightComplaints")
  };

  try {
    const metrics = await API.getMetrics();
    Object.entries(metricEls).forEach(([key, el]) => {
      if (!el) return;
      const value = metrics[key] ?? 0;
      el.textContent = key === "totalPayments" ? formatPKR(value) : value;
    });

    // Populate insight cards with live data
    if (insightEls.complaints) {
      insightEls.complaints.textContent = metrics.pendingComplaints ?? 0;
    }
    if (insightEls.vacantRooms) {
      insightEls.vacantRooms.textContent = metrics.vacantRooms ?? 0;
    }
    if (insightEls.beds) {
      // Derive open beds from rooms
      const rooms = await API.getRooms();
      const openBeds = rooms.reduce(
        (sum, room) => sum + Math.max(0, Number(room.capacity) - Number(room.current_occupancy || 0)),
        0
      );
      insightEls.beds.textContent = openBeds;
    }

    renderPaymentsChart(metrics.totalPayments || 0);
  } catch (error) {
    UI.toast(error.message, "error");
  }
};

const loadAllocationsSnapshot = async () => {
  try {
    const timeline = document.getElementById("allocationTimeline");
    const allocations = await API.getAllocations();
    if (!timeline) return;

    if (!allocations.length) {
      timeline.innerHTML = "<p class='empty-state'>No allocations yet</p>";
      return;
    }

    timeline.innerHTML = allocations
      .slice(0, 6)
      .map(
        (allocation) => `
        <div class="timeline-item">
          <div>
            <strong>${allocation.student_name}</strong>
            <p>Room ${allocation.room_number} • ${allocation.allocation_date}</p>
          </div>
        </div>
      `
      )
      .join("");
  } catch (error) {
    UI.toast(error.message, "error");
  }
};

const renderPaymentsChart = (total) => {
  const canvas = document.getElementById("paymentsChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const baseValue = Number(total) / months.length || 500;
  const data = months.map((_, index) => Math.max(120, baseValue + (index - 2) * 60));

  const max = Math.max(...data);
  const chartHeight = canvas.height;
  const chartWidth = canvas.width;
  const barWidth = chartWidth / (data.length * 1.8);

  ctx.clearRect(0, 0, chartWidth, chartHeight);
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "center";

  data.forEach((value, index) => {
    const height = (value / max) * (chartHeight - 40);
    const x = 40 + index * (barWidth * 1.8);
    const y = chartHeight - height - 20;

    const gradient = ctx.createLinearGradient(0, y, 0, y + height);
    gradient.addColorStop(0, "rgba(90, 84, 255, 0.9)");
    gradient.addColorStop(1, "rgba(139, 92, 246, 0.7)");

    ctx.fillStyle = gradient;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, height, 12);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, barWidth, height);
    }

    ctx.fillStyle = "#94a3b8";
    ctx.fillText(months[index], x + barWidth / 2, chartHeight - 5);
  });
};

export { initDashboard };

