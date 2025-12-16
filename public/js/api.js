const API_BASE = "";

const buildQuery = (params = {}) => {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== "" && value !== null);
  if (!entries.length) return "";
  const query = new URLSearchParams(entries);
  return `?${query.toString()}`;
};

const request = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  let data;
  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.message || "Something went wrong");
  }

  return data;
};

export const API = {
  // Students
  getStudents: (params) => request(`/students${buildQuery(params)}`),
  getStudent: (id) => request(`/students/${id}`),
  createStudent: (payload) => request("/add-student", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  updateStudent: (id, payload) => request(`/students/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  }),
  deleteStudent: (id) => request(`/students/${id}`, { method: "DELETE" }),

  // Rooms
  getRooms: () => request("/rooms"),
  createRoom: (payload) => request("/rooms/add", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  updateRoom: (id, payload) => request(`/rooms/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  }),
  deleteRoom: (id) => request(`/rooms/${id}`, { method: "DELETE" }),
  getRoomDetails: (id) => request(`/rooms/${id}`),

  // Allocations
  allocate: (payload) => request("/allocate", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  getAllocations: (params) => request(`/allocations${buildQuery(params)}`),

  // Complaints
  addComplaint: (payload) => request("/complaints/add", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  getComplaints: (params) => request(`/complaints${buildQuery(params)}`),
  updateComplaint: (id, payload) => request(`/complaints/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  }),
  deleteComplaint: (id) => request(`/complaints/${id}`, { method: "DELETE" }),

  // Payments
  addPayment: (payload) => request("/payments/add", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  getPayments: (params) => request(`/payments${buildQuery(params)}`),
  getStudentDue: (id) => request(`/students/${id}/fee-status`),
  getFeeStatus: (id) => request(`/students/${id}/fee-status`),

  // Dashboard
  getMetrics: () => request("/dashboard/metrics"),

  // Floors
  getFloorOverview: () => request("/floors/overview"),

  // Transfers
  transferRoom: (payload) => request("/transfer-room", {
    method: "POST",
    body: JSON.stringify(payload)
  }),

  // Hostel profile
  getHostelProfile: () => request("/hostel/profile"),
  updateHostelProfile: (payload) => request("/hostel/profile", {
    method: "PUT",
    body: JSON.stringify(payload)
  })
};

