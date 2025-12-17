import { API } from "./api.js";
import { UI } from "./ui.js";

const CNIC_REGEX = /^\d{5}-\d{7}-\d$/;
const PHONE_REGEX = /^(?:\+92|0)?3\d{2}-?\d{7}$/;
const formatPKR = (value = 0) => `PKR ${Number(value || 0).toLocaleString("en-PK")}`;
const statusTone = (status) => {
  switch (status) {
    case "Paid":
      return "success";
    case "Late":
      return "warning";
    case "Defaulter":
    case "Critical Defaulter":
      return "danger";
    case "Payment Pending":
      return "warning";
    default:
      return "";
  }
};

const debounce = (fn, delay = 350) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

const queryParam = (key) => new URLSearchParams(window.location.search).get(key);

const initForms = (page) => {
  const handlers = {
    "add-student": setupAddStudent,
    "edit-student": setupEditStudent,
    students: setupStudentsList,
    "add-room": setupAddRoom,
    rooms: setupRoomsList,
    allocate: setupAllocate,
    complaints: setupComplaints,
    payments: setupPayments,
    settings: setupSettings
  };

  handlers[page]?.();
};

const sanitizeStudentPayload = (payload) => {
  const clean = { ...payload };
  ["name", "cnic", "department", "phone", "address"].forEach((key) => {
    if (clean[key] !== undefined && clean[key] !== null) {
      clean[key] = String(clean[key]).trim();
    }
  });
  return clean;
};

const validateStudentPayload = (payload) => {
  const clean = sanitizeStudentPayload(payload);
  Object.assign(payload, clean);

  const { name, cnic, department, phone, address } = clean;
  if (!name || !cnic || !department || !phone || !address) {
    return "Name, department, CNIC, phone, and address are required";
  }
  if (!/^[A-Za-z ]+$/.test(name)) {
    return "Name must contain only letters and spaces";
  }
  if (!/^[A-Za-z ]+$/.test(department)) {
    return "Department must contain only letters and spaces";
  }
  if (!CNIC_REGEX.test(cnic)) {
    return "CNIC must follow 12345-1234567-1";
  }
  if (!PHONE_REGEX.test(phone)) {
    return "Phone must be a valid Pakistani mobile number";
  }
  if (!address || address.length < 6) {
    return "Address must be at least 6 characters";
  }
  if (address.length > 100) {
    return "Address cannot exceed 100 characters";
  }
  return null;
};

const friendlyRoomType = (type) => (type ? type.charAt(0).toUpperCase() + type.slice(1) : "Unspecified");
const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const validateRoomFormPayload = (payload, { requireAll = true } = {}) => {
  const errors = [];
  if (requireAll && !payload.room_number?.trim()) errors.push("Room number is required");
  if (payload.room_number && payload.room_number.trim().length > 12) {
    errors.push("Room number must be under 12 characters");
  }
  if (payload.room_number) {
    const roomNum = payload.room_number.trim();
    const numericRoom = Number(roomNum);
    if (!Number.isNaN(numericRoom) && numericRoom < 0) {
      errors.push("Room number cannot be negative");
    }
  }
  if (payload.capacity !== undefined) {
    if (!Number.isFinite(payload.capacity) || payload.capacity <= 0 || payload.capacity > 50) {
      errors.push("Capacity must be between 1 and 50");
    }
  } else if (requireAll) {
    errors.push("Capacity is required");
  }

  if (payload.monthly_fee !== undefined) {
    if (!Number.isFinite(payload.monthly_fee) || payload.monthly_fee < 0 || payload.monthly_fee > 500000) {
      errors.push("Monthly fee must be between 0 and 500,000 PKR");
    }
  } else if (requireAll) {
    errors.push("Monthly fee is required");
  }

  if (payload.floor_level !== undefined) {
    if (!Number.isInteger(payload.floor_level) || payload.floor_level < 0 || payload.floor_level > 200) {
      errors.push("Floor must be an integer between 0 and 200");
    }
  } else if (requireAll) {
    errors.push("Floor is required");
  }

  return errors.length ? errors.join(". ") : null;
};

// --- Students ---
const setupAddStudent = () => {
  const form = document.getElementById("addStudentForm");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const validationError = validateStudentPayload(payload);
    if (validationError) {
      UI.toast(validationError, "error");
      return;
    }

    try {
      UI.setLoading(form.querySelector("button[type='submit']"), true, "Saving...");
      await API.createStudent(payload);
      form.reset();
      UI.toast("Student added successfully");
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setLoading(form.querySelector("button[type='submit']"), false);
    }
  });
};

const setupEditStudent = async () => {
  const id = queryParam("id");
  const form = document.getElementById("editStudentForm");
  const statusEl = document.getElementById("editStatus");

  if (!id) {
    statusEl.textContent = "Missing student ID.";
    return;
  }

  try {
    statusEl.textContent = "Loading student...";
    const student = await API.getStudent(id);
    ["name", "cnic", "department", "phone", "address"].forEach((field) => {
      form.elements[field].value = student[field] || "";
    });
    statusEl.textContent = "";
  } catch (error) {
    statusEl.textContent = error.message;
    return;
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const validationError = validateStudentPayload(payload);
    if (validationError) {
      UI.toast(validationError, "error");
      return;
    }

    try {
      UI.setLoading(form.querySelector("button[type='submit']"), true, "Updating...");
      await API.updateStudent(id, payload);
      UI.toast("Student updated successfully");
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setLoading(form.querySelector("button[type='submit']"), false);
    }
  });
};

const setupStudentsList = () => {
  const searchInput = document.getElementById("studentSearch");
  const sortSelect = document.getElementById("studentSort");
  const orderSelect = document.getElementById("studentOrder");
  const tableBody = document.querySelector("#studentsTable tbody");
  const refreshBtn = document.getElementById("refreshStudents");

  const loadStudents = async () => {
    try {
      refreshBtn?.setAttribute("aria-busy", "true");
      const students = await API.getStudents({
        search: searchInput?.value ?? "",
        sortBy: sortSelect?.value,
        order: orderSelect?.value
      });
      renderStudents(students, tableBody);
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      refreshBtn?.removeAttribute("aria-busy");
    }
  };

  const debouncedLoad = debounce(loadStudents, 350);

  searchInput?.addEventListener("input", debouncedLoad);
  sortSelect?.addEventListener("change", loadStudents);
  orderSelect?.addEventListener("change", loadStudents);
  refreshBtn?.addEventListener("click", loadStudents);

  tableBody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (target.matches("[data-action='delete-student']")) {
      const id = target.dataset.id;
      const confirmed = await UI.confirm("Delete this student and related records?");
      if (!confirmed) return;
      try {
        await API.deleteStudent(id);
        UI.toast("Student deleted");
        loadStudents();
      } catch (error) {
        UI.toast(error.message, "error");
      }
    }
  });

  loadStudents();
};

const renderStudents = (students = [], tableBody) => {
  if (!tableBody) return;
  tableBody.innerHTML = "";
  if (!students.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7" class="empty-state">No students found</td>`;
    tableBody.appendChild(row);
    return;
  }

  students.forEach((student) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${student.student_id}</td>
      <td>${student.name}</td>
      <td>${student.department ?? "—"}</td>
      <td>${student.cnic ?? "—"}</td>
      <td>${student.phone ?? "—"}</td>
      <td>${student.address ?? "—"}</td>
      <td class="action-group">
        <a class="btn btn-outline" href="edit-student.html?id=${student.student_id}">Edit</a>
        <button class="btn btn-danger" data-action="delete-student" data-id="${student.student_id}">Delete</button>
      </td>
    `;
    tableBody.appendChild(row);
  });
};

// --- Rooms ---
const setupAddRoom = () => {
  const form = document.getElementById("addRoomForm");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      room_number: formData.get("room_number")?.toString().trim(),
      room_type: formData.get("room_type")?.toString().trim(),
      capacity: toNumber(formData.get("capacity")),
      monthly_fee: toNumber(formData.get("monthly_fee")),
      floor_level: toNumber(formData.get("floor_level")),
      wifi_available: 0
    };

    const validationError = validateRoomFormPayload(payload, { requireAll: true });
    if (validationError) {
      UI.toast(validationError, "error");
      return;
    }

    try {
      UI.setLoading(form.querySelector("button[type='submit']"), true, "Saving...");
      await API.createRoom(payload);
      form.reset();
      UI.toast("Room added successfully");
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setLoading(form.querySelector("button[type='submit']"), false);
    }
  });
};

const setupRoomsList = () => {
  const tableBody = document.querySelector("#roomsTable tbody");
  const roomInfo = document.getElementById("roomInfo");
  const editModal = document.getElementById("editRoomModal");
  const editFields = {
    room_number: document.getElementById("edit_room_number"),
    room_type: document.getElementById("edit_room_type"),
    capacity: document.getElementById("edit_capacity"),
    monthly_fee: document.getElementById("edit_monthly_fee"),
    floor_level: document.getElementById("edit_floor_level"),
    wifi_available: document.getElementById("edit_wifi")
  };
  const editSave = document.getElementById("edit-room-save");
  const editCancel = document.getElementById("edit-room-cancel");
  let editingRoomId = null;

  const loadRooms = async () => {
    try {
      const rooms = await API.getRooms();
      renderRooms(rooms, tableBody);
    } catch (error) {
      UI.toast(error.message, "error");
    }
  };

  tableBody?.addEventListener("click", async (event) => {
    const target = event.target;
    const roomId = target.dataset.id;
    if (!roomId) return;

    if (target.matches("[data-action='view-room']")) {
      const data = await API.getRoomDetails(roomId);
      renderRoomInfo(data, roomInfo);
      roomInfo?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (target.matches("[data-action='edit-room']")) {
      try {
        const details = await API.getRoomDetails(roomId);
        editingRoomId = roomId;
        editFields.room_number.value = details.room_number ?? "";
        editFields.room_type.value = details.room_type ?? "";
        editFields.capacity.value = details.capacity ?? "";
        editFields.monthly_fee.value = details.monthly_fee ?? "";
        editFields.floor_level.value = details.floor_level ?? 0;
        editFields.wifi_available.checked = Boolean(Number(details.wifi_available));
        editModal?.classList.add("visible");
      } catch (error) {
        UI.toast(error.message, "error");
      }
    }

    if (target.matches("[data-action='delete-room']")) {
      const confirmed = await UI.confirm("Delete this room? It must be empty.");
      if (!confirmed) return;
      try {
        await API.deleteRoom(roomId);
        UI.toast("Room deleted");
        loadRooms();
      } catch (error) {
        UI.toast(error.message, "error");
      }
    }
  });

  editCancel?.addEventListener("click", () => {
    editModal?.classList.remove("visible");
    editingRoomId = null;
  });

  editSave?.addEventListener("click", async () => {
    if (!editingRoomId) return;
    const payload = {
      room_number: editFields.room_number.value.trim(),
      room_type: editFields.room_type.value.trim(),
      capacity: toNumber(editFields.capacity.value),
      monthly_fee: toNumber(editFields.monthly_fee.value),
      floor_level: toNumber(editFields.floor_level.value),
      wifi_available: editFields.wifi_available.checked ? 1 : 0
    };

    const validationError = validateRoomFormPayload(payload, { requireAll: false });
    if (validationError) {
      UI.toast(validationError, "error");
      return;
    }

    try {
      UI.setLoading(editSave, true, "Saving...");
      await API.updateRoom(editingRoomId, payload);
      UI.toast("Room updated");
      editModal?.classList.remove("visible");
      editingRoomId = null;
      await loadRooms();
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setLoading(editSave, false);
    }
  });

  loadRooms();
};

const renderRooms = (rooms = [], tableBody) => {
  if (!tableBody) return;
  tableBody.innerHTML = "";
  if (!rooms.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="8" class="empty-state">No rooms found</td>`;
    tableBody.appendChild(row);
    return;
  }

  rooms.forEach((room) => {
    const vacancy = room.capacity - room.current_occupancy;
    const wifiStatus = Number(room.wifi_available) ? "Yes" : "No";
    const row = document.createElement("tr");
    row.id = `room-${room.room_id}`;
    const friendlyType = friendlyRoomType(room.room_type);
    row.innerHTML = `
      <td>${room.room_id}</td>
      <td>${room.room_number}</td>
      <td>${friendlyType}</td>
      <td>${room.capacity}</td>
      <td>${room.current_occupancy}</td>
      <td>${room.floor_level ?? "—"}</td>
      <td>${vacancy}</td>
      <td>${room.monthly_fee ? formatPKR(room.monthly_fee) : "—"}</td>
      <td>${wifiStatus}</td>
      <td class="action-group">
        <button class="btn btn-outline" data-action="view-room" data-id="${room.room_id}">Students</button>
        <button class="btn btn-outline" data-action="edit-room" data-id="${room.room_id}">Edit</button>
        <button class="btn btn-danger" data-action="delete-room" data-id="${room.room_id}">Delete</button>
      </td>
    `;
    tableBody.appendChild(row);
  });
};

const renderRoomInfo = (data, container) => {
  if (!container) return;
  if (!data || data.message) {
    container.innerHTML = `<p>${data?.message ?? "Unable to load room."}</p>`;
    return;
  }

  const studentsList = data.students?.length
    ? data.students.map((s) => `<li>${s.student_id} — ${s.name}</li>`).join("")
    : "<li>No students allocated</li>";
  const wifiAvailable = Boolean(Number(data.wifi_available));
  const friendlyType = friendlyRoomType(data.room_type);

  container.innerHTML = `
    <h3>Room ${data.room_number}</h3>
    <p>Capacity: ${data.capacity}</p>
    <p>Current occupancy: ${data.current_occupancy}</p>
    <p>Floor: ${data.floor_level ?? "—"}</p>
    <p>Type: ${friendlyType}</p>
    <p>Monthly fee per student: ${data.monthly_fee ? formatPKR(data.monthly_fee) : "—"}</p>
    <p>Wi-Fi: ${wifiAvailable ? "Available" : "Not available"}</p>
    <ul>${studentsList}</ul>
  `;
};

// --- Allocation ---
const setupAllocate = async () => {
  const studentHidden = document.getElementById("allocationStudent");
  const studentSearch = document.getElementById("allocationStudentSearch");
  const studentResults = document.getElementById("allocationStudentResults");
  const roomSelect = document.getElementById("allocationRoom");
  const form = document.getElementById("allocateForm");
  const roomSnapshot = document.getElementById("roomSnapshot");
  const allocationsTable = document.querySelector("#allocationsTable tbody");
  const allocationSearch = document.getElementById("allocationSearch");
  const transferModal = document.getElementById("transferModal");
  const transferSelect = document.getElementById("transferRoomSelect");
  const transferCancel = document.getElementById("transfer-cancel");
  const transferConfirm = document.getElementById("transfer-confirm");
  let transferContext = { studentId: null };

  initStudentLookup(studentSearch, studentResults, studentHidden);
  await populateRooms(roomSelect);
  await loadAllocations();

  allocationSearch?.addEventListener("input", debounce(loadAllocations, 300));

  allocationsTable?.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action='transfer-room']");
    if (!target) return;

    const studentId = target.dataset.student;
    const currentRoomId = target.dataset.room;
    try {
      target.disabled = true;
      target.textContent = "Loading...";
      const rooms = await API.getRooms();
      const openRooms = rooms.filter((room) => Number(room.capacity) > Number(room.current_occupancy));
      if (!openRooms.length) {
        UI.toast("No rooms with available beds", "error");
        return;
      }
      transferSelect.innerHTML = openRooms
        .map(
          (room) =>
            `<option value="${room.room_id}">${room.room_number} • ${friendlyRoomType(room.room_type)} • ${room.capacity - room.current_occupancy} open • Floor ${room.floor_level ?? "—"}</option>`
        )
        .join("");
      transferContext = { studentId, currentRoomId };
      transferModal?.classList.add("visible");
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      target.disabled = false;
      target.textContent = "Transfer";
    }
  });

  transferCancel?.addEventListener("click", () => {
    transferModal?.classList.remove("visible");
  });

  transferConfirm?.addEventListener("click", async () => {
    const newRoomId = parseInt(transferSelect?.value, 10);
    if (!newRoomId) {
      UI.toast("Select a target room", "error");
      return;
    }
    if (String(newRoomId) === String(transferContext.currentRoomId)) {
      UI.toast("Student is already in this room", "error");
      return;
    }
    try {
      UI.setLoading(transferConfirm, true, "Transferring...");
      await API.transferRoom({ student_id: transferContext.studentId, new_room_id: newRoomId });
      UI.toast("Room transfer successful");
      transferModal?.classList.remove("visible");
      await loadAllocations();
      await populateRooms(roomSelect);
      roomSnapshot.innerHTML = "";
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setLoading(transferConfirm, false);
    }
  });

  roomSelect?.addEventListener("change", async () => {
    const roomId = roomSelect.value;
    if (!roomId) return;
    const data = await API.getRoomDetails(roomId);
    renderRoomSnapshot(data, roomSnapshot);
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      student_id: studentHidden?.value,
      room_id: roomSelect?.value
    };

    if (!payload.student_id) {
      UI.toast("Please select a student from the lookup", "error");
      return;
    }
    if (!payload.room_id) {
      UI.toast("Please choose a room", "error");
      return;
    }

    try {
      UI.setLoading(form.querySelector("button[type='submit']"), true, "Allocating...");
      await API.allocate(payload);
      UI.toast("Student allocated successfully");
      form.reset();
      if (studentHidden) studentHidden.value = "";
      await populateRooms(roomSelect);
      roomSnapshot.innerHTML = "";
      await loadAllocations();
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setLoading(form.querySelector("button[type='submit']"), false);
    }
  });

  async function loadAllocations() {
    if (!allocationsTable) return;
    try {
      const data = await API.getAllocations({ search: allocationSearch?.value?.trim() });
      renderAllocations(data, allocationsTable);
    } catch (error) {
      UI.toast(error.message, "error");
    }
  }
};

const renderRoomSnapshot = (data, container) => {
  if (!container) return;
  if (!data || data.message) {
    container.innerHTML = `<p>${data?.message ?? "Unable to load room details."}</p>`;
    return;
  }

  const difficulty = data.current_occupancy >= data.capacity ? "danger" : "success";
  const wifiAvailable = Boolean(Number(data.wifi_available));
  const friendlyType = friendlyRoomType(data.room_type);
  container.innerHTML = `
    <article class="list-card">
      <header style="display:flex;justify-content:space-between;align-items:center;">
        <h4>${data.room_number}</h4>
        <span class="badge ${difficulty}">${difficulty === "danger" ? "Full" : "Open"}</span>
      </header>
      <p>Capacity: ${data.capacity}</p>
      <p>Occupied: ${data.current_occupancy}</p>
      <p>Available: ${data.capacity - data.current_occupancy}</p>
      <p>Type: ${friendlyType}</p>
      <p>Monthly fee per student: ${data.monthly_fee ? formatPKR(data.monthly_fee) : "—"}</p>
      <p>Floor: ${data.floor_level ?? "—"}</p>
      <p>Wi-Fi: ${wifiAvailable ? "Available" : "Not available"}</p>
    </article>
  `;
};

const renderAllocations = (allocations = [], tableBody) => {
  if (!tableBody) return;
  tableBody.innerHTML = "";
  if (!allocations.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7" class="empty-state">No allocations found</td>`;
    tableBody.appendChild(row);
    return;
  }

  allocations.forEach((allocation) => {
    const friendlyType = friendlyRoomType(allocation.room_type);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${allocation.student_name}</td>
      <td>${allocation.room_number}</td>
      <td>${friendlyType}</td>
      <td>${allocation.monthly_fee ? formatPKR(allocation.monthly_fee) : "—"}</td>
      <td>${allocation.allocation_date}</td>
      <td>${allocation.student_id}</td>
      <td class="action-group">
        <button class="btn btn-outline" data-action="transfer-room" data-student="${allocation.student_id}" data-room="${allocation.room_id}">Transfer</button>
      </td>
    `;
    tableBody.appendChild(row);
  });
};

// --- Complaints ---
const setupComplaints = async () => {
  const complaintForm = document.getElementById("complaintForm");
  const studentHidden = document.getElementById("complaintStudent");
  const studentSearch = document.getElementById("complaintStudentSearch");
  const studentResults = document.getElementById("complaintStudentResults");
  const listContainer = document.getElementById("complaintsList");
  const complaintSearch = document.getElementById("complaintSearch");

  initStudentLookup(studentSearch, studentResults, studentHidden);

  const loadComplaints = async () => {
    try {
      const complaints = await API.getComplaints({ search: complaintSearch?.value?.trim() });
      renderComplaints(complaints, listContainer);
    } catch (error) {
      UI.toast(error.message, "error");
    }
  };

  complaintSearch?.addEventListener("input", debounce(loadComplaints, 300));

  complaintForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!studentHidden?.value) {
      UI.toast("Please select a student from the lookup", "error");
      return;
    }
    const payload = Object.fromEntries(new FormData(complaintForm).entries());
    try {
      UI.setLoading(complaintForm.querySelector("button[type='submit']"), true, "Sending...");
      await API.addComplaint(payload);
      complaintForm.reset();
      if (studentHidden) studentHidden.value = "";
      if (studentSearch) studentSearch.value = "";
      studentResults?.classList.remove("visible");
      UI.toast("Complaint submitted");
      loadComplaints();
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setLoading(complaintForm.querySelector("button[type='submit']"), false);
    }
  });

  listContainer?.addEventListener("click", async (event) => {
    const target = event.target;
    const id = target.dataset.id;
    if (!id) return;

    if (target.matches("[data-action='resolve-complaint']")) {
      await updateComplaint(id, { status: "Resolved" }, loadComplaints);
    }

    if (target.matches("[data-action='delete-complaint']")) {
      const confirmed = await UI.confirm("Delete this complaint?");
      if (!confirmed) return;
      try {
        await API.deleteComplaint(id);
        UI.toast("Complaint deleted");
        loadComplaints();
      } catch (error) {
        UI.toast(error.message, "error");
      }
    }
  });

  loadComplaints();
};

const updateComplaint = async (id, payload, refresh) => {
  try {
    if (payload.status && !["Pending", "Resolved"].includes(payload.status)) {
      UI.toast("Status must be Pending or Resolved", "error");
      return;
    }
    if (payload.complaint_text !== undefined) {
      const text = String(payload.complaint_text).trim();
      if (text.length < 3) {
        UI.toast("Complaint must be at least 3 characters", "error");
        return;
      }
      if (text.length > 500) {
        UI.toast("Complaint cannot exceed 500 characters", "error");
        return;
      }
    }
    await API.updateComplaint(id, payload);
    UI.toast("Complaint updated");
    refresh?.();
  } catch (error) {
    UI.toast(error.message, "error");
  }
};

const renderComplaints = (complaints = [], container) => {
  if (!container) return;
  if (!complaints.length) {
    container.innerHTML = `<div class="empty-state">No complaints yet.</div>`;
    return;
  }

  container.innerHTML = complaints
    .map(
      (complaint) => `
    <article class="list-card">
      <header>
        <strong>${complaint.student_name ?? "Unknown student"}</strong>
        <span class="badge ${complaint.status === "Resolved" ? "success" : "warning"}">${complaint.status}</span>
      </header>
      <p>${complaint.complaint_text}</p>
      <div class="action-group">
        <button class="btn btn-outline" data-action="resolve-complaint" data-id="${complaint.complaint_id}">
          Resolve
        </button>
        <button class="btn btn-danger" data-action="delete-complaint" data-id="${complaint.complaint_id}">
          Delete
        </button>
      </div>
    </article>
  `
    )
    .join("");
};

// --- Payments ---
const setupPayments = async () => {
  const paymentForm = document.getElementById("paymentForm");
  const paymentStudentHidden = document.getElementById("paymentStudent");
  const paymentStudentSearch = document.getElementById("paymentStudentSearch");
  const paymentStudentResults = document.getElementById("paymentStudentResults");
  const filterHidden = document.getElementById("paymentFilterStudent");
  const filterSearch = document.getElementById("paymentFilterSearch");
  const filterResults = document.getElementById("paymentFilterResults");
  const tableBody = document.querySelector("#paymentsTable tbody");
  const totalEl = document.getElementById("paymentsTotal");
  const dueHint = document.getElementById("paymentDueHint");
  const amountInput = paymentForm?.elements["amount"];
  const feeStatusBadge = document.getElementById("feeStatusBadge");
  const feeDueDate = document.getElementById("feeDueDate");
  const feeFine = document.getElementById("feeFine");
  const feeTotal = document.getElementById("feeTotal");
  const feeStatusNote = document.getElementById("feeStatusNote");

  const updateDueHint = (message = "Select a student to view monthly dues.") => {
    if (dueHint) dueHint.textContent = message;
  };
  updateDueHint();

  const resetFeeCard = (message = "Select a student to view billing details.") => {
    if (feeStatusBadge) {
      feeStatusBadge.textContent = "—";
      feeStatusBadge.className = "badge";
    }
    if (feeDueDate) feeDueDate.textContent = "—";
    if (feeFine) feeFine.textContent = formatPKR(0);
    if (feeTotal) feeTotal.textContent = formatPKR(0);
    if (feeStatusNote) feeStatusNote.textContent = message;
  };

  const applyFeeCard = (info) => {
    if (!info) {
      resetFeeCard();
      return;
    }
    const tone = statusTone(info.fee_status);
    if (feeStatusBadge) {
      feeStatusBadge.textContent = info.fee_status || "—";
      feeStatusBadge.className = `badge ${tone}`.trim();
    }
    if (feeDueDate) feeDueDate.textContent = info.due_date ?? "Not set";
    if (feeFine) feeFine.textContent = formatPKR(info.fine || 0);
    if (feeTotal) feeTotal.textContent = formatPKR(info.total_payable || info.monthly_fee || 0);
    if (feeStatusNote) {
      const base = info.last_payment_date ? `Last paid on ${info.last_payment_date}.` : "No payments recorded yet.";
      const late = info.days_late > 0 ? ` ${info.days_late} day(s) late.` : "";
      feeStatusNote.textContent = `${base}${late}`.trim();
    }
  };

  resetFeeCard();

  const applyDueAmount = async (studentId) => {
    if (!studentId) {
      updateDueHint();
      resetFeeCard();
      if (amountInput) amountInput.value = "";
      return;
    }
    try {
      const dueInfo = await API.getFeeStatus(studentId);
      const friendlyType = friendlyRoomType(dueInfo.room_type);
      const dueDateLabel = dueInfo.due_date ? `Due by ${dueInfo.due_date}` : "First payment pending";
      updateDueHint(`${friendlyType} · ${dueDateLabel} · Monthly ${formatPKR(dueInfo.monthly_fee)}`);
      if (amountInput) amountInput.value = dueInfo.total_payable || dueInfo.monthly_fee || "";
      applyFeeCard(dueInfo);
    } catch (error) {
      updateDueHint(error.message);
      resetFeeCard(error.message);
      if (amountInput) amountInput.value = "";
    }
  };

  const loadPayments = async () => {
    try {
      const payments = await API.getPayments({
        student_id: filterHidden?.value || undefined
      });

      const uniqueStudents = [...new Set(payments.map((p) => p.student_id).filter(Boolean))];
      const statusMap = {};

      await Promise.all(
        uniqueStudents.map(async (id) => {
          try {
            statusMap[id] = await API.getFeeStatus(id);
          } catch (statusErr) {
            statusMap[id] = null;
          }
        })
      );

      renderPayments(payments, tableBody, totalEl, statusMap);
    } catch (error) {
      UI.toast(error.message, "error");
    }
  };

  initStudentLookup(paymentStudentSearch, paymentStudentResults, paymentStudentHidden, {
    onSelect: (id) => applyDueAmount(id)
  });

  initStudentLookup(filterSearch, filterResults, filterHidden, {
    allowEmpty: true,
    onSelect: () => loadPayments()
  });

  filterSearch?.addEventListener("input", () => {
    if (!filterSearch.value.trim()) {
      filterHidden.value = "";
      loadPayments();
    }
  });

  paymentForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!paymentStudentHidden?.value) {
      UI.toast("Please select a student before recording payment", "error");
      return;
    }
    const payload = Object.fromEntries(new FormData(paymentForm).entries());
    try {
      UI.setLoading(paymentForm.querySelector("button[type='submit']"), true, "Recording...");
      await API.addPayment(payload);
      paymentForm.reset();
      if (paymentStudentHidden) paymentStudentHidden.value = "";
      if (paymentStudentSearch) paymentStudentSearch.value = "";
      paymentStudentResults?.classList.remove("visible");
      updateDueHint();
      resetFeeCard();
      loadPayments();
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setLoading(paymentForm.querySelector("button[type='submit']"), false);
    }
  });

  paymentForm?.addEventListener("reset", () => {
    resetFeeCard();
    updateDueHint();
  });

  loadPayments();
};

const renderPayments = (payments = [], tableBody, totalEl, statusMap = {}) => {
  if (!tableBody) return;
  let total = 0;
  tableBody.innerHTML = "";

  if (!payments.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="8" class="empty-state">No payments recorded</td>`;
    tableBody.appendChild(row);
    if (totalEl) totalEl.textContent = formatPKR(0);
    return;
  }

  payments.forEach((payment) => {
    total += Number(payment.amount) || 0;
    const statusInfo = statusMap[payment.student_id];
    const statusText = statusInfo?.fee_status ?? "—";
    const badgeTone = statusText === "—" ? "" : statusTone(statusText);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${payment.payment_id}</td>
      <td>${payment.student_name ?? "Unknown"}</td>
      <td>${formatPKR(payment.amount)}</td>
      <td>${payment.date}</td>
      <td><span class="badge ${badgeTone}">${statusText}</span></td>
      <td>${statusInfo?.due_date ?? "—"}</td>
      <td>${statusInfo ? formatPKR(statusInfo.fine) : "—"}</td>
      <td>${statusInfo ? formatPKR(statusInfo.total_payable) : "—"}</td>
    `;
    tableBody.appendChild(row);
  });

  if (totalEl) totalEl.textContent = formatPKR(total);
};

// --- Settings ---
const setupSettings = () => {
  const themeSwitch = document.getElementById("themeSwitch");
  const currentTheme = document.body.dataset.theme === "dark";
  if (themeSwitch) {
    themeSwitch.checked = currentTheme;
    themeSwitch.addEventListener("change", () => {
      document.body.dataset.theme = themeSwitch.checked ? "dark" : "light";
      localStorage.setItem("hostelmate:theme", document.body.dataset.theme);
      UI.toast(`Switched to ${document.body.dataset.theme} mode`);
    });
  }

  const profileForm = document.getElementById("hostelProfileForm");
  const statusEl = document.getElementById("hostelProfileStatus");
  const saveBtn = profileForm?.querySelector("button[type='submit']");

  const setStatus = (text, tone = "neutral") => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = `badge ${tone === "error" ? "danger" : tone === "success" ? "success" : ""}`;
  };

  const loadProfile = async () => {
    if (!profileForm) return;
    try {
      setStatus("Loading...");
      const profile = await API.getHostelProfile();
      profileForm.hostel_name.value = profile.hostel_name ?? "";
      profileForm.location.value = profile.location ?? "";
      if (profile.contact_email !== undefined) profileForm.contact_email.value = profile.contact_email ?? "";
      if (profile.logo_url !== undefined) profileForm.logo_url.value = profile.logo_url ?? "";
      setStatus("Loaded", "success");
    } catch (error) {
      setStatus(error.message || "Failed to load", "error");
      UI.toast(error.message, "error");
    }
  };

  profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(profileForm);
    const payload = Object.fromEntries(formData.entries());
    if (!payload.hostel_name?.trim() || !payload.location?.trim()) {
      UI.toast("Hostel name and location are required", "error");
      return;
    }
    try {
      UI.setLoading(saveBtn, true, "Saving...");
      await API.updateHostelProfile(payload);
      setStatus("Saved", "success");
      UI.toast("Hostel profile updated");
    } catch (error) {
      setStatus("Error", "error");
      UI.toast(error.message, "error");
    } finally {
      UI.setLoading(saveBtn, false);
    }
  });

  loadProfile();
};

// --- Helpers ---
const populateRooms = async (select) => {
  if (!select) return;
  const rooms = await API.getRooms();
  UI.setOptions(select, rooms, (room) => ({
    label: `${room.room_number} • ${friendlyRoomType(room.room_type)} • Floor ${room.floor_level ?? "—"} • ${formatPKR(room.monthly_fee)} • ${
      room.capacity - room.current_occupancy
    } open`,
    value: room.room_id
  }));
};

const initStudentLookup = (input, results, hiddenInput, options = {}) => {
  if (!input || !results || !hiddenInput) return;
  const { allowEmpty = false, onSelect } = options;

  const showMessage = (message) => {
    results.innerHTML = `<div class="lookup-option">${message}</div>`;
    results.classList.add("visible");
  };

  const handleSelect = (id, label) => {
    hiddenInput.value = id;
    input.value = label;
    results.classList.remove("visible");
    onSelect?.(id, label);
  };

  const search = debounce(async (term) => {
    if (!term || term.length < 2) {
      if (term.length === 0) {
        results.classList.remove("visible");
        if (allowEmpty) onSelect?.("", "");
      } else {
        showMessage("Type at least 2 characters");
      }
      return;
    }
    try {
      const students = await API.getStudents({ search: term, order: "asc", sortBy: "name" });
      if (!students.length) {
        showMessage("No students found");
        return;
      }
      results.innerHTML = students
        .slice(0, 8)
        .map(
          (student) => `
            <button type="button" class="lookup-option" data-id="${student.student_id}" data-label="${student.name} — ${student.department ?? "—"}">
              <strong>${student.name}</strong>
              <span>${student.department ?? "—"} • ${student.cnic}</span>
            </button>
          `
        )
        .join("");
      results.classList.add("visible");
    } catch (error) {
      UI.toast(error.message, "error");
    }
  }, 300);

  input.addEventListener("input", () => {
    hiddenInput.value = "";
    const term = input.value.trim();
    if (!term && allowEmpty) {
      onSelect?.("", "");
    }
    search(term);
  });

  input.addEventListener("focus", () => {
    if (results.children.length) {
      results.classList.add("visible");
    }
  });

  results.addEventListener("click", (event) => {
    const option = event.target.closest(".lookup-option");
    if (!option) return;
    handleSelect(option.dataset.id, option.dataset.label);
  });

  document.addEventListener("click", (event) => {
    if (!results.contains(event.target) && event.target !== input) {
      results.classList.remove("visible");
    }
  });
};

export { initForms };

