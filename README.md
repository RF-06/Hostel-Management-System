 # Hostel Management App

 Node/Express + SQLite hostel management with a static HTML/CSS/JS frontend served from `public/`. Handles students, rooms, allocations, payments with late-fee rules, complaints, and basic dashboard metrics.

 ## Features
 - Students: add/edit/delete with validation (CNIC, phone, address).
 - Rooms: capacity, type, monthly fee, wifi flag, floor level; occupancy tracked.
 - Allocations: assign/transfer students; occupancy auto-updates.
 - Payments: monthly fee with runtime fee status (Pending → Paid → Late → Defaulter → Critical). Due date = last payment + 30 days; late fee = PKR 100/day. Rejects pre-allocation, partial, or over payments.
 - Complaints: submit, list, resolve/delete.
 - Dashboard: metrics, floor overview, payments log.

 ## Tech Stack
 - Backend: Node.js, Express 5, SQLite (`hostel.db`).
 - Frontend: vanilla HTML/CSS/JS (no framework), served by Express.

 ## Getting Started (Local)
 ```bash
 npm install
 npm start
 # default: http://localhost:3000
 ```

 ## Environment Variables
 - `PORT` (optional): server port (default `3000`).
 - `DB_PATH` (optional): SQLite file path (default `./hostel.db`). Set this when using a mounted disk in production (e.g., Render).

 ## Key Endpoints (JSON)
 - Students: `GET /students`, `POST /add-student`, `PUT /students/:id`, `DELETE /students/:id`
 - Rooms: `GET /rooms`, `POST /rooms/add`, `PUT /rooms/:id`, `DELETE /rooms/:id`
 - Allocations: `POST /allocate`, `POST /transfer-room`, `GET /allocations`
 - Payments: `POST /payments/add` (amount must match expected fee), `GET /payments`, `GET /students/:id/fee-status`
 - Complaints: `POST /complaints/add`, `GET /complaints`, `PUT /complaints/:id`, `DELETE /complaints/:id`
 - Dashboard/Meta: `GET /dashboard/metrics`, `GET /floors/overview`, `GET /hostel/profile`, `PUT /hostel/profile`

 ## Payments & Fee Status (runtime only)
 - First payment: exact monthly fee after allocation.
 - Billing: due date = last payment date + 30 days (no cron/timers).
 - Late fee: PKR 100 × days late (if past due).
 - Status is calculated per response (not stored): Pending → Paid → Late (1–5 days) → Defaulter (6–30) → Critical Defaulter (>30).
 - Rejects payments before allocation, and any partial/extra amounts.

 ## Frontend Pages
 - `public/index.html` (landing), `dashboard.html`, `students.html`, `rooms.html`, `allocate.html`, `payments.html`, `complaints.html`, `settings.html`.
 - Assets and JS utilities live under `public/js` and `public/css`.

 ## Deploy to Render (quick)
 1) Ensure `server.js` uses:
    ```js
    const db = new sqlite3.Database(process.env.DB_PATH || "./hostel.db");
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
    ```
 2) Push to GitHub.
 3) Render → New Web Service → connect repo.
    - Build: `npm install`
    - Start: `npm start`
    - Runtime: Node 18+ (default is fine)
 4) (Optional) Add a persistent Disk (e.g., 1 GB) mounted at `/data`, and set env `DB_PATH=/data/hostel.db`. Without a disk, data resets on each deploy.
 5) Deploy and use the provided URL.

