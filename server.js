const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static("public"));

const MAX_MONTHLY_FEE = 500000; // upper guardrail for monthly fees 
const MAX_ROOM_CAPACITY = 50; // prevent impossible room sizes
const DB_PATH = process.env.DB_PATH || "./hostel.db";
const PORT = process.env.PORT || 3000;

// Create SQLite database
const db = new sqlite3.Database(DB_PATH);

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS Students(
    student_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, 
    cnic TEXT UNIQUE, 
    department TEXT, 
    phone TEXT,
    address TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS Hostels(
    hostel_id INTEGER PRIMARY KEY AUTOINCREMENT,
    hostel_name TEXT, 
    location TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS Rooms(
    room_id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_number TEXT,
    capacity INTEGER,
    current_occupancy INTEGER DEFAULT 0,
    floor_level INTEGER DEFAULT 0,
    room_type TEXT,
    monthly_fee REAL,
    wifi_available INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS Allocations(
    allocation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    room_id INTEGER,
    allocation_date TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS Payments(
    payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    amount REAL,
    date TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS Complaints(
    complaint_id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    complaint_text TEXT,
    status TEXT
  )`);

  const addColumnIfMissing = (table, column, definition) => {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, err => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error(`Failed to add ${column} to ${table}:`, err.message);
      }
    });
  };

  addColumnIfMissing("Students", "address", "TEXT");
  addColumnIfMissing("Rooms", "floor_level", "INTEGER DEFAULT 0");
  addColumnIfMissing("Rooms", "room_type", "TEXT");
  addColumnIfMissing("Rooms", "monthly_fee", "REAL");
  addColumnIfMissing("Rooms", "wifi_available", "INTEGER DEFAULT 0");
  addColumnIfMissing("Hostels", "contact_email", "TEXT");
  addColumnIfMissing("Hostels", "logo_url", "TEXT");

  db.get("SELECT hostel_id FROM Hostels LIMIT 1", (err, row) => {
    if (err) {
      console.error("Failed to seed hostel profile:", err.message);
      return;
    }
    if (!row) {
      db.run(
        `INSERT INTO Hostels(hostel_name, location, contact_email, logo_url) VALUES (?, ?, ?, ?)`,
        ["Your Hostel", "Pakistan", "admin@example.com", ""],
        (seedErr) => {
          if (seedErr) {
            console.error("Failed to insert default hostel profile:", seedErr.message);
          }
        }
      );
    }
  });

});

const parseBoolean = (value) => value === true || value === "true" || value === 1 || value === "1";
const DAY_MS = 24 * 60 * 60 * 1000;
const startOfTodayUTC = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
const parseDbDate = (value) => (value ? new Date(`${value}T00:00:00Z`) : null);
const formatDateISO = (dateObj) => (dateObj ? dateObj.toISOString().slice(0, 10) : null);
const addDays = (dateObj, days) => {
  const copy = new Date(dateObj.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};
const resolveFeeStatus = (rawDaysLate, hasPayment) => {
  if (!hasPayment) return "Payment Pending";
  if (rawDaysLate === null || rawDaysLate <= 0) return "Paid";
  if (rawDaysLate <= 5) return "Late";
  if (rawDaysLate <= 30) return "Defaulter";
  return "Critical Defaulter";
};

const buildFeeSnapshot = (studentId, callback) => {
  db.get(
    `SELECT Allocations.allocation_date, Rooms.monthly_fee, Rooms.room_type
     FROM Allocations
     JOIN Rooms ON Rooms.room_id = Allocations.room_id
     WHERE Allocations.student_id = ?`,
    [studentId],
    (allocErr, allocRow) => {
      if (allocErr) return callback({ status: 500, message: "Error verifying allocation" });
      if (!allocRow) return callback({ status: 400, message: "Student must be allocated to a room before paying fees" });

      const monthlyFee = Number(allocRow.monthly_fee);
      if (!Number.isFinite(monthlyFee) || monthlyFee <= 0) {
        return callback({ status: 500, message: "Room fee is not configured for this allocation" });
      }

      db.get(
        `SELECT date FROM Payments WHERE student_id = ? ORDER BY date DESC LIMIT 1`,
        [studentId],
        (paymentErr, paymentRow) => {
          if (paymentErr) return callback({ status: 500, message: "Error fetching payment history" });

          const today = startOfTodayUTC();
          const lastPaymentDate = paymentRow ? paymentRow.date : null;
          const lastPayment = parseDbDate(lastPaymentDate);
          const hasPayment = Boolean(lastPayment);

          let dueDate = null;
          let rawDaysLate = null;
          if (hasPayment) {
            dueDate = addDays(lastPayment, 30);
            rawDaysLate = Math.floor((today - dueDate) / DAY_MS);
          }

          const daysLate = rawDaysLate !== null && rawDaysLate > 0 ? rawDaysLate : 0;
          const fine = daysLate > 0 ? daysLate * 100 : 0;
          const fee_status = resolveFeeStatus(rawDaysLate, hasPayment);

          callback(null, {
            student_id: studentId,
            monthly_fee: monthlyFee,
            room_type: allocRow.room_type,
            allocation_date: allocRow.allocation_date,
            last_payment_date: lastPaymentDate,
            due_date: dueDate ? formatDateISO(dueDate) : null,
            days_late: daysLate,
            fine,
            total_payable: monthlyFee + fine,
            fee_status,
            today: formatDateISO(today)
          });
        }
      );
    }
  );
};
const ROOM_NUMBER_MAX_LENGTH = 12;

const validateRoomPayload = (body, { requireAll = false } = {}) => {
  const errors = [];
  const clean = {};

  if (body.room_number !== undefined) {
    clean.room_number = String(body.room_number).trim();
    if (!clean.room_number) {
      errors.push("Room number is required");
    } else if (clean.room_number.length > ROOM_NUMBER_MAX_LENGTH) {
      errors.push(`Room number must be under ${ROOM_NUMBER_MAX_LENGTH} characters`);
    } else {
      const numericRoom = Number(clean.room_number);
      if (!Number.isNaN(numericRoom) && numericRoom < 0) {
        errors.push("Room number cannot be negative");
      }
    }
  } else if (requireAll) {
    errors.push("Room number is required");
  }

  if (body.room_type !== undefined) {
    clean.room_type = String(body.room_type).trim();
  }

  if (body.capacity !== undefined) {
    const capacity = Number(body.capacity);
    if (!Number.isFinite(capacity) || capacity <= 0 || capacity > MAX_ROOM_CAPACITY) {
      errors.push(`Capacity must be between 1 and ${MAX_ROOM_CAPACITY}`);
    } else {
      clean.capacity = capacity;
    }
  } else if (requireAll) {
    errors.push("Capacity is required");
  }

  if (body.monthly_fee !== undefined) {
    const monthlyFee = Number(body.monthly_fee);
    if (!Number.isFinite(monthlyFee) || monthlyFee < 0 || monthlyFee > MAX_MONTHLY_FEE) {
      errors.push(`Monthly fee must be between 0 and ${MAX_MONTHLY_FEE} PKR`);
    } else {
      clean.monthly_fee = monthlyFee;
    }
  } else if (requireAll) {
    errors.push("Monthly fee is required");
  }

  if (body.floor_level !== undefined) {
    const floor = Number(body.floor_level);
    if (!Number.isInteger(floor) || floor < 0 || floor > 200) {
      errors.push("Floor must be an integer between 0 and 200");
    } else {
      clean.floor_level = floor;
    }
  } else if (requireAll) {
    clean.floor_level = 0;
  }

  if (body.wifi_available !== undefined) {
    clean.wifi_available = parseBoolean(body.wifi_available) ? 1 : 0;
  } else if (requireAll) {
    clean.wifi_available = 0;
  }

  return { errors, clean };
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validateHostelPayload = (body = {}) => {
  const errors = [];
  const clean = {};

  if (body.hostel_name !== undefined) {
    clean.hostel_name = String(body.hostel_name).trim();
    if (!clean.hostel_name) errors.push("Hostel name is required");
  } else {
    errors.push("Hostel name is required");
  }

  if (body.location !== undefined) {
    clean.location = String(body.location).trim();
    if (!clean.location) errors.push("Location is required");
  } else {
    errors.push("Location is required");
  }

  if (body.contact_email !== undefined) {
    const email = String(body.contact_email).trim();
    if (email && !EMAIL_REGEX.test(email)) {
      errors.push("Contact email is invalid");
    } else {
      clean.contact_email = email;
    }
  }

  if (body.logo_url !== undefined) {
    clean.logo_url = String(body.logo_url).trim();
  }

  return { errors, clean };
};

// --------------------
// 1️⃣ Add Student
// --------------------
const CNIC_REGEX = /^\d{5}-\d{7}-\d$/;
const PHONE_REGEX = /^(?:\+92|0)?3\d{2}-?\d{7}$/;
// Phone is intentionally not unique because siblings/guardians may share a contact number.
const NAME_REGEX = /^[A-Za-z ]+$/;
const DEPT_REGEX = /^[A-Za-z ]+$/;

const validateStudentPayload = (payload = {}) => {
  const errors = [];
  const clean = {
    name: payload.name?.toString().trim(),
    cnic: payload.cnic?.toString().trim(),
    department: payload.department?.toString().trim(),
    phone: payload.phone?.toString().trim(),
    address: payload.address?.toString().trim()
  };

  if (!clean.name) errors.push("Name is required");
  if (clean.name && !NAME_REGEX.test(clean.name)) errors.push("Name must contain only letters and spaces");

  if (!clean.department) errors.push("Department is required");
  if (clean.department && !DEPT_REGEX.test(clean.department)) errors.push("Department must contain only letters and spaces");

  if (!clean.cnic) errors.push("CNIC is required");
  if (clean.cnic && !CNIC_REGEX.test(clean.cnic)) errors.push("CNIC must follow 12345-1234567-1 format");

  if (!clean.phone) errors.push("Phone is required");
  if (clean.phone && !PHONE_REGEX.test(clean.phone)) errors.push("Phone must be a valid Pakistani mobile number");

  if (!clean.address) {
    errors.push("Address is required");
  } else {
    if (clean.address.length < 6) errors.push("Address must be at least 6 characters");
    if (clean.address.length > 100) errors.push("Address cannot exceed 100 characters");
  }

  return { errors, clean };
};

app.post("/add-student", (req, res) => {
  const { errors, clean } = validateStudentPayload(req.body || {});
  if (errors.length) return res.status(400).json({ message: errors.join("; ") });

  db.get('SELECT student_id FROM Students WHERE cnic = ?', [clean.cnic], (dupErr, existing) => {
    if (dupErr) {
      console.error("Error checking CNIC:", dupErr.message);
      return res.status(500).json({ message: "Error validating student" });
    }
    if (existing) {
      return res.status(409).json({ message: "CNIC already exists" });
    }

    db.run(
      "INSERT INTO Students (name, cnic, department, phone, address) VALUES (?, ?, ?, ?, ?)",
      [clean.name, clean.cnic, clean.department, clean.phone, clean.address || null],
      function(err) {
        if (err) {
          console.error("Error adding student:", err.message);
          return res.status(500).json({ message: "Error adding student: " + err.message });
        }
        res.json({ message: "Student added successfully", student_id: this.lastID });
      }
    );
  });
});

// --------------------
// Get all students (with optional search + sorting)
// --------------------
app.get('/students', (req, res) => {
  const {
    search = '',
    sortBy = 'name',
    order = 'asc'
  } = req.query;

  const sortableFields = {
    name: 'name',
    department: 'department',
    cnic: 'cnic',
    student_id: 'student_id',
    phone: 'phone'
  };

  const sortField = sortableFields[sortBy] || 'name';
  const sortDirection = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  let query = 'SELECT student_id, name, cnic, department, phone, address FROM Students';
  const params = [];

  if (search) {
    query += ' WHERE name LIKE ? OR cnic LIKE ? OR department LIKE ? OR phone LIKE ? OR address LIKE ?';
    const wild = `%${search}%`;
    params.push(wild, wild, wild, wild, wild);
  }

  query += ` ORDER BY ${sortField} ${sortDirection}`;

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching students:', err.message);
      return res.status(500).json({ message: 'Error fetching students' });
    }
    res.json(rows);
  });
});

// --------------------
// Get single student
// --------------------
app.get('/students/:id', (req, res) => {
  const studentId = parseInt(req.params.id);
  if (!studentId) return res.status(400).json({ message: 'Invalid student id' });

  db.get('SELECT * FROM Students WHERE student_id = ?', [studentId], (err, student) => {
    if (err) {
      console.error('Error fetching student:', err.message);
      return res.status(500).json({ message: 'Error fetching student' });
    }
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json(student);
  });
});

// --------------------
// Update student
// --------------------
app.put('/students/:id', (req, res) => {
  const studentId = parseInt(req.params.id);
  if (!studentId) return res.status(400).json({ message: 'Invalid student id' });

  const { errors, clean } = validateStudentPayload(req.body || {});
  if (errors.length) return res.status(400).json({ message: errors.join("; ") });

  db.get('SELECT student_id FROM Students WHERE cnic = ? AND student_id != ?', [clean.cnic, studentId], (dupErr, existing) => {
    if (dupErr) {
      console.error('Error checking CNIC:', dupErr.message);
      return res.status(500).json({ message: 'Error validating student' });
    }
    if (existing) {
      return res.status(409).json({ message: 'CNIC already exists' });
    }

    db.run(
      `UPDATE Students
       SET name = ?, cnic = ?, department = ?, phone = ?, address = ?
       WHERE student_id = ?`,
      [clean.name, clean.cnic, clean.department, clean.phone, clean.address || null, studentId],
      function(err) {
        if (err) {
          console.error('Error updating student:', err.message);
          return res.status(500).json({ message: 'Error updating student: ' + err.message });
        }

        if (this.changes === 0) {
          return res.status(404).json({ message: 'Student not found' });
        }

        res.json({ message: 'Student updated successfully' });
      }
    );
  });
});

// --------------------
// 2️⃣ Allocate Room
// --------------------
app.post("/allocate", (req, res) => {
  const { student_id, room_id } = req.body;

  if (!student_id || !room_id) {
    return res.status(400).json({ message: "Student and room are required" });
  }

  db.get('SELECT student_id FROM Students WHERE student_id = ?', [student_id], (studentErr, student) => {
    if (studentErr) {
      console.error('Error verifying student:', studentErr.message);
      return res.status(500).json({ message: 'Error verifying student' });
    }
    if (!student) return res.status(404).json({ message: 'Student does not exist' });

    db.get('SELECT allocation_id FROM Allocations WHERE student_id = ?', [student_id], (allocationErr, allocation) => {
      if (allocationErr) {
        console.error('Error checking allocation:', allocationErr.message);
        return res.status(500).json({ message: 'Error checking allocation' });
      }
      if (allocation) {
        return res.status(400).json({ message: 'Student is already allocated to a room' });
      }

      db.get(
        "SELECT capacity, current_occupancy FROM Rooms WHERE room_id = ?",
        [room_id],
        (err, room) => {
          if (err) return res.status(500).json({ message: "Error fetching room" });
          if (!room) return res.status(404).json({ message: `Room ID ${room_id} does not exist` });

          if (room.current_occupancy >= room.capacity) {
            return res.status(400).json({ message: "Room is full" });
          }

          db.run(
            "INSERT INTO Allocations(student_id, room_id, allocation_date) VALUES (?, ?, date('now'))",
            [student_id, room_id],
            function(err2) {
              if (err2) {
                console.error('Error allocating student:', err2.message);
                return res.status(500).json({ message: "Error allocating student" });
              }

              db.run(
                "UPDATE Rooms SET current_occupancy = current_occupancy + 1 WHERE room_id = ?",
                [room_id],
                function(err3) {
                  if (err3) {
                    console.error('Error updating room:', err3.message);
                    return res.status(500).json({ message: "Error updating room" });
                  }

                  res.json({ message: "Student allocated successfully" });
                }
              );
            }
          );
        }
      );
    });
  });
});

// --------------------
// Transfer Room
// --------------------
app.post("/transfer-room", (req, res) => {
  const studentId = parseInt(req.body.student_id);
  const newRoomId = parseInt(req.body.new_room_id);

  if (!studentId || !newRoomId) {
    return res.status(400).json({ message: "student_id and new_room_id are required" });
  }

  db.serialize(() => {
    const rollback = (status, message) => {
      db.run("ROLLBACK");
      res.status(status).json({ message });
    };

    db.run("BEGIN TRANSACTION");

    db.get("SELECT student_id FROM Students WHERE student_id = ?", [studentId], (errStudent, student) => {
      if (errStudent) return rollback(500, "Error verifying student");
      if (!student) return rollback(404, "Student does not exist");

      db.get("SELECT allocation_id, room_id FROM Allocations WHERE student_id = ?", [studentId], (errAlloc, allocation) => {
        if (errAlloc) return rollback(500, "Error checking allocation");
        if (!allocation) return rollback(400, "Student is not allocated to any room");

        const oldRoomId = allocation.room_id;

        db.get("SELECT capacity, current_occupancy FROM Rooms WHERE room_id = ?", [newRoomId], (errRoom, room) => {
          if (errRoom) return rollback(500, "Error fetching new room");
          if (!room) return rollback(404, `Room ID ${newRoomId} does not exist`);
          if (Number(oldRoomId) === Number(newRoomId)) return rollback(400, "Student is already in this room");
          if (room.current_occupancy >= room.capacity) return rollback(400, "New room is full");

          db.run(
            "UPDATE Allocations SET room_id = ?, allocation_date = date('now') WHERE allocation_id = ?",
            [newRoomId, allocation.allocation_id],
            function(errUpdateAlloc) {
              if (errUpdateAlloc) return rollback(500, "Error updating allocation");

              db.run(
                "UPDATE Rooms SET current_occupancy = CASE WHEN current_occupancy > 0 THEN current_occupancy - 1 ELSE 0 END WHERE room_id = ?",
                [oldRoomId],
                function(errDec) {
                  if (errDec) return rollback(500, "Error updating old room occupancy");

                  db.run(
                    "UPDATE Rooms SET current_occupancy = current_occupancy + 1 WHERE room_id = ?",
                    [newRoomId],
                    function(errInc) {
                      if (errInc) return rollback(500, "Error updating new room occupancy");

                      db.run("COMMIT", (errCommit) => {
                        if (errCommit) return rollback(500, "Error committing transfer");
                        res.json({ message: "Room transfer successful", from_room_id: oldRoomId, to_room_id: newRoomId });
                      });
                    }
                  );
                }
              );
            }
          );
        });
      });
    });
  });
});

// --------------------
// Get allocations
// --------------------
app.get('/allocations', (req, res) => {
  const { search = '' } = req.query;
  const hasSearch = Boolean(search);
  const like = `%${search}%`;
  const query = `
    SELECT 
      Allocations.allocation_id,
      Allocations.student_id,
      Allocations.room_id,
      Allocations.allocation_date,
      Students.name AS student_name,
      Rooms.room_number,
      Rooms.room_type,
      Rooms.monthly_fee,
      Rooms.floor_level,
      Rooms.wifi_available
    FROM Allocations
    JOIN Students ON Students.student_id = Allocations.student_id
    JOIN Rooms ON Rooms.room_id = Allocations.room_id
    ${hasSearch ? 'WHERE Students.name LIKE ? OR Rooms.room_number LIKE ? OR Allocations.allocation_date LIKE ?' : ''}
    ORDER BY Allocations.allocation_date DESC
  `;
  const params = hasSearch ? [like, like, like] : [];

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching allocations:', err.message);
      return res.status(500).json({ message: 'Error fetching allocations' });
    }
    res.json(rows);
  });
});

// --------------------
// 3️⃣ Record Payment
// --------------------
app.post("/payments/add", (req, res) => {
  const { student_id, amount } = req.body;
  const studentId = parseInt(student_id);

  if (!studentId || amount === undefined) {
    return res.status(400).json({ message: "Student and amount are required" });
  }

  const amountValue = Number(amount);
  if (!Number.isFinite(amountValue) || amountValue <= 0 || amountValue > MAX_MONTHLY_FEE) {
    return res.status(400).json({ message: `Invalid payment amount (max ${MAX_MONTHLY_FEE} PKR)` });
  }

  db.get('SELECT student_id FROM Students WHERE student_id = ?', [studentId], (err, student) => {
    if (err) {
      console.error('Error verifying student for payment:', err.message);
      return res.status(500).json({ message: 'Error verifying student' });
    }
    if (!student) {
      return res.status(404).json({ message: 'Student does not exist' });
    }

    buildFeeSnapshot(studentId, (snapErr, snapshot) => {
      if (snapErr) {
        return res.status(snapErr.status || 500).json({ message: snapErr.message || "Unable to evaluate fee status" });
      }

      const expected = Math.round(snapshot.total_payable * 100) / 100;
      const provided = Math.round(amountValue * 100) / 100;

      if (provided !== expected) {
        const reason = !snapshot.last_payment_date
          ? "First payment must match the monthly fee."
          : snapshot.days_late > 0
            ? `Includes PKR ${snapshot.fine} late fee for ${snapshot.days_late} day(s).`
            : "Payment must match the monthly fee for this billing cycle.";

        return res.status(400).json({
          message: `Expected payment is PKR ${expected}. ${reason} Partial or extra payments are not allowed.`
        });
      }

      db.run(
        "INSERT INTO Payments(student_id, amount, date) VALUES (?, ?, date('now'))",
        [studentId, expected],
        function(insertErr) {
          if (insertErr) {
            console.error('Error recording payment:', insertErr.message);
            return res.status(500).json({ message: "Error recording payment" });
          }

          buildFeeSnapshot(studentId, (postErr, updatedSnapshot) => {
            if (postErr) {
              console.error('Payment recorded but fee status refresh failed:', postErr.message);
              return res.json({ message: "Payment recorded", id: this.lastID });
            }
            res.json({ message: "Payment recorded", id: this.lastID, fee_status: updatedSnapshot });
          });
        }
      );
    });
  });
});

const handleFeeStatusRequest = (req, res) => {
  const studentId = parseInt(req.params.id);
  if (!studentId) return res.status(400).json({ message: 'Invalid student id' });

  db.get('SELECT student_id FROM Students WHERE student_id = ?', [studentId], (err, student) => {
    if (err) {
      console.error('Error verifying student for fee status:', err.message);
      return res.status(500).json({ message: 'Error verifying student' });
    }
    if (!student) {
      return res.status(404).json({ message: 'Student does not exist' });
    }

    buildFeeSnapshot(studentId, (snapErr, snapshot) => {
      if (snapErr) {
        return res.status(snapErr.status || 500).json({ message: snapErr.message || 'Error fetching fee status' });
      }
      res.json(snapshot);
    });
  });
};

app.get('/students/:id/due', handleFeeStatusRequest);
app.get('/students/:id/fee-status', handleFeeStatusRequest);

// --------------------
// Get payments (optional filter by student)
// --------------------
app.get('/payments', (req, res) => {
  const { student_id } = req.query;
  let query = `
    SELECT Payments.*, Students.name AS student_name
    FROM Payments
    LEFT JOIN Students ON Students.student_id = Payments.student_id
  `;
  const params = [];

  if (student_id) {
    query += ' WHERE Payments.student_id = ?';
    params.push(student_id);
  }

  query += ' ORDER BY date DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching payments:', err.message);
      return res.status(500).json({ message: 'Error fetching payments' });
    }
    res.json(rows);
  });
});

// --------------------
// 4️⃣ Submit Complaint
// --------------------
app.post("/complaints/add", (req, res) => {
  const { student_id, complaint_text } = req.body;

  if (!student_id || !complaint_text) {
    return res.status(400).json({ message: "Student and complaint are required" });
  }

  const text = complaint_text.toString().trim();
  if (text.length < 3) {
    return res.status(400).json({ message: "Complaint must be at least 3 characters" });
  }
  if (text.length > 500) {
    return res.status(400).json({ message: "Complaint cannot exceed 500 characters" });
  }

  db.get('SELECT student_id FROM Students WHERE student_id = ?', [student_id], (err, student) => {
    if (err) {
      console.error('Error verifying student for complaint:', err.message);
      return res.status(500).json({ message: 'Error verifying student' });
    }
    if (!student) return res.status(404).json({ message: 'Student does not exist' });

    db.run(
      "INSERT INTO Complaints(student_id, complaint_text, status) VALUES (?, ?, 'Pending')",
      [student_id, text],
      function(insertErr) {
        if (insertErr) {
          console.error('Error submitting complaint:', insertErr.message);
          return res.status(500).json({ message: "Error submitting complaint" });
        }
        res.json({ message: "Complaint submitted", id: this.lastID });
      }
    );
  });
});

// --------------------
// Complaint list + update + delete
// --------------------
app.get('/complaints', (req, res) => {
  const { search = '' } = req.query;
  const hasSearch = Boolean(search);
  const like = `%${search}%`;
  const query = `
    SELECT Complaints.*, Students.name AS student_name
    FROM Complaints
    LEFT JOIN Students ON Students.student_id = Complaints.student_id
    ${hasSearch ? 'WHERE Students.name LIKE ? OR Complaints.complaint_text LIKE ? OR Complaints.status LIKE ?' : ''}
    ORDER BY Complaints.status ASC, Complaints.complaint_id DESC
  `;
  const params = hasSearch ? [like, like, like] : [];
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching complaints:', err.message);
      return res.status(500).json({ message: 'Error fetching complaints' });
    }
    res.json(rows);
  });
});

app.put('/complaints/:id', (req, res) => {
  const complaintId = parseInt(req.params.id);
  if (!complaintId) return res.status(400).json({ message: 'Invalid complaint id' });

  const { status, complaint_text } = req.body;
  if (!status && !complaint_text) {
    return res.status(400).json({ message: 'Nothing to update' });
  }

  if (status && !["Pending", "Resolved"].includes(status)) {
    return res.status(400).json({ message: "Status must be Pending or Resolved" });
  }

  if (complaint_text !== undefined) {
    const text = complaint_text.toString().trim();
    if (text.length < 3) {
      return res.status(400).json({ message: "Complaint must be at least 3 characters" });
    }
    if (text.length > 500) {
      return res.status(400).json({ message: "Complaint cannot exceed 500 characters" });
    }
  }

  db.run(
    `UPDATE Complaints
     SET status = COALESCE(?, status),
         complaint_text = COALESCE(?, complaint_text)
     WHERE complaint_id = ?`,
    [status, complaint_text, complaintId],
    function(err) {
      if (err) {
        console.error('Error updating complaint:', err.message);
        return res.status(500).json({ message: 'Error updating complaint' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'Complaint not found' });
      }
      res.json({ message: 'Complaint updated' });
    }
  );
});

app.delete('/complaints/:id', (req, res) => {
  const complaintId = parseInt(req.params.id);
  if (!complaintId) return res.status(400).json({ message: 'Invalid complaint id' });

  db.run('DELETE FROM Complaints WHERE complaint_id = ?', [complaintId], function(err) {
    if (err) {
      console.error('Error deleting complaint:', err.message);
      return res.status(500).json({ message: 'Error deleting complaint' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: 'Complaint not found' });
    }
    res.json({ message: 'Complaint deleted' });
  });
});


// --------------------
// 5️⃣ Get Room Students
// --------------------
app.get("/rooms/:id", (req, res) => {
  const roomId = parseInt(req.params.id);

  db.get("SELECT * FROM Rooms WHERE room_id = ?", [roomId], (err, room) => {
    if (err) {
      return res.json({ message: "Error fetching room" });
    }

    if (!room) {
      return res.json({ message: "Room ID " + roomId + " does not exist" });
    }

    db.all(
      "SELECT Students.student_id, Students.name FROM Allocations JOIN Students ON Students.student_id = Allocations.student_id WHERE Allocations.room_id = ?",
      [roomId],
      (err2, students) => {
        if (err2) {
          return res.json({ message: "Error fetching students" });
        }

        return res.json({
          room_id: roomId,
          room_number: room.room_number,
          capacity: room.capacity,
          current_occupancy: room.current_occupancy,
          room_type: room.room_type,
          monthly_fee: room.monthly_fee,
          floor_level: room.floor_level,
          wifi_available: !!room.wifi_available,
          students: students,
          message: students && students.length ? undefined : "No students in this room"
        });
      }
    );
  });
});

// --------------------
// 6️⃣ Get All Rooms
// --------------------
app.get("/rooms", (req, res) => {
  db.all("SELECT * FROM Rooms", (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});

// --------------------
// Create room
// --------------------
app.post('/rooms/add', (req, res) => {
  const { errors, clean } = validateRoomPayload(req.body, { requireAll: true });
  if (errors.length) return res.status(400).json({ message: errors.join("; ") });

  db.get('SELECT room_id FROM Rooms WHERE room_number = ?', [clean.room_number], (dupErr, existing) => {
    if (dupErr) {
      console.error('Error checking room number:', dupErr.message);
      return res.status(500).json({ message: 'Error validating room number' });
    }
    if (existing) {
      return res.status(400).json({ message: 'Room number already exists' });
    }

    db.run(
      `INSERT INTO Rooms(room_number, capacity, current_occupancy, floor_level, room_type, monthly_fee, wifi_available)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
      [
        clean.room_number,
        clean.capacity,
        clean.floor_level ?? 0,
        clean.room_type || "Standard",
        clean.monthly_fee,
        clean.wifi_available ?? 0
      ],
      function(err) {
        if (err) {
          console.error('Error adding room:', err.message);
          return res.status(500).json({ message: 'Error adding room' });
        }
        res.json({ message: 'Room added successfully', room_id: this.lastID });
      }
    );
  });
});

// --------------------
// Update room
// --------------------
app.put('/rooms/:id', (req, res) => {
  const roomId = parseInt(req.params.id);
  if (!roomId) return res.status(400).json({ message: 'Invalid room id' });

  const { errors, clean } = validateRoomPayload(req.body, { requireAll: false });
  if (errors.length) return res.status(400).json({ message: errors.join("; ") });
  if (!Object.keys(clean).length) return res.status(400).json({ message: 'No updates provided' });

  db.get('SELECT current_occupancy, capacity FROM Rooms WHERE room_id = ?', [roomId], (err, room) => {
    if (err) {
      console.error('Error fetching room:', err.message);
      return res.status(500).json({ message: 'Error fetching room' });
    }
    if (!room) return res.status(404).json({ message: 'Room not found' });

    if (clean.capacity !== undefined && clean.capacity < room.current_occupancy) {
      return res.status(400).json({ message: 'Capacity cannot be less than current occupancy' });
    }

    const proceedUpdate = () => {
      const updateFields = [];
      const values = [];
      const entries = {
        room_number: clean.room_number,
        capacity: clean.capacity,
        floor_level: clean.floor_level,
        room_type: clean.room_type,
        monthly_fee: clean.monthly_fee,
        wifi_available: clean.wifi_available
      };

      Object.entries(entries).forEach(([key, value]) => {
        if (value !== undefined) {
          updateFields.push(`${key} = ?`);
          values.push(value);
        }
      });

      values.push(roomId);

      db.run(
        `UPDATE Rooms SET ${updateFields.join(', ')} WHERE room_id = ?`,
        values,
        function(updateErr) {
          if (updateErr) {
            console.error('Error updating room:', updateErr.message);
            return res.status(500).json({ message: 'Error updating room' });
          }
          if (this.changes === 0) {
            return res.status(404).json({ message: 'Room not found or no changes provided' });
          }
          res.json({ message: 'Room updated successfully' });
        }
      );
    };

    if (clean.room_number) {
      db.get('SELECT room_id FROM Rooms WHERE room_number = ? AND room_id != ?', [clean.room_number, roomId], (dupErr, existing) => {
        if (dupErr) {
          console.error('Error checking room number:', dupErr.message);
          return res.status(500).json({ message: 'Error validating room number' });
        }
        if (existing) {
          return res.status(400).json({ message: 'Room number already exists' });
        }
        proceedUpdate();
      });
    } else {
      proceedUpdate();
    }
  });
});

// --------------------
// Delete room
// --------------------
app.delete('/rooms/:id', (req, res) => {
  const roomId = parseInt(req.params.id);
  if (!roomId) return res.status(400).json({ message: 'Invalid room id' });

  db.get('SELECT current_occupancy FROM Rooms WHERE room_id = ?', [roomId], (err, room) => {
    if (err) {
      console.error('Error fetching room for deletion:', err.message);
      return res.status(500).json({ message: 'Error deleting room' });
    }
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (room.current_occupancy > 0) {
      return res.status(400).json({ message: 'Cannot delete a room with allocated students' });
    }

    db.run('DELETE FROM Rooms WHERE room_id = ?', [roomId], function(delErr) {
      if (delErr) {
        console.error('Error deleting room:', delErr.message);
        return res.status(500).json({ message: 'Error deleting room' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'Room not found' });
      }
      res.json({ message: 'Room deleted successfully' });
    });
  });
});

// --------------------
// 7️⃣ Delete Student (also remove related rows and update room occupancy)
// --------------------
app.delete('/students/:id', (req, res) => {
  const studentId = parseInt(req.params.id);
  if (!studentId) return res.status(400).json({ message: 'Invalid student id' });

  // Run operations in a transaction to keep DB consistent
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // Check if student exists
    db.get('SELECT student_id FROM Students WHERE student_id = ?', [studentId], (err, student) => {
      if (err) {
        db.run('ROLLBACK');
        console.error('Error checking student existence:', err.message);
        return res.status(500).json({ message: 'Error deleting student' });
      }
      if (!student) {
        db.run('ROLLBACK');
        return res.status(404).json({ message: 'Student not found' });
      }

      // Find allocations for this student so we can decrement room occupancy appropriately
      db.all('SELECT room_id FROM Allocations WHERE student_id = ?', [studentId], (err2, allocations) => {
        if (err2) {
          db.run('ROLLBACK');
          console.error('Error fetching allocations:', err2.message);
          return res.status(500).json({ message: 'Error deleting student' });
        }

        // Decrement occupancy for each allocation (only if occupancy > 0)
        const roomIds = allocations.map(a => a.room_id);
        // Use a simple sequential loop via recursion to update rooms
        function updateRooms(index) {
          if (index >= roomIds.length) return deleteDependentRows();
          const roomId = roomIds[index];
          db.run(
            'UPDATE Rooms SET current_occupancy = current_occupancy - 1 WHERE room_id = ? AND current_occupancy > 0',
            [roomId],
            function (upErr) {
              if (upErr) {
                db.run('ROLLBACK');
                console.error('Error updating room occupancy:', upErr.message);
                return res.status(500).json({ message: 'Error deleting student' });
              }
              updateRooms(index + 1);
            }
          );
        }

        function deleteDependentRows() {
          // Delete allocations
          db.run('DELETE FROM Allocations WHERE student_id = ?', [studentId], function (delAllocErr) {
            if (delAllocErr) {
              db.run('ROLLBACK');
              console.error('Error deleting allocations:', delAllocErr.message);
              return res.status(500).json({ message: 'Error deleting student' });
            }

            // Delete payments
            db.run('DELETE FROM Payments WHERE student_id = ?', [studentId], function (delPaymentsErr) {
              if (delPaymentsErr) {
                db.run('ROLLBACK');
                console.error('Error deleting payments:', delPaymentsErr.message);
                return res.status(500).json({ message: 'Error deleting student' });
              }

              // Delete complaints
              db.run('DELETE FROM Complaints WHERE student_id = ?', [studentId], function (delComplErr) {
                if (delComplErr) {
                  db.run('ROLLBACK');
                  console.error('Error deleting complaints:', delComplErr.message);
                  return res.status(500).json({ message: 'Error deleting student' });
                }

                // Finally delete student
                db.run('DELETE FROM Students WHERE student_id = ?', [studentId], function (delStudentErr) {
                  if (delStudentErr) {
                    db.run('ROLLBACK');
                    console.error('Error deleting student:', delStudentErr.message);
                    return res.status(500).json({ message: 'Error deleting student' });
                  }

                  db.run('COMMIT');
                  return res.json({ message: 'Student and related records deleted successfully' });
                });
              });
            });
          });
        }

        // start updating rooms
        updateRooms(0);
      });
    });
  });
});


// --------------------
// Test route
// --------------------
app.get("/", (req, res) => {
  res.send("Hostel Management Backend is running!");
});

// --------------------
// Dashboard metrics
// --------------------
app.get('/dashboard/metrics', (req, res) => {
  const counts = {};

  db.get('SELECT COUNT(*) AS total FROM Students', (err, row) => {
    if (err) return res.status(500).json({ message: 'Error fetching metrics' });
    counts.totalStudents = row ? row.total : 0;

    db.get('SELECT COUNT(*) AS total FROM Rooms', (err2, row2) => {
      if (err2) return res.status(500).json({ message: 'Error fetching metrics' });
      counts.totalRooms = row2 ? row2.total : 0;

      db.get('SELECT COUNT(*) AS total FROM Allocations', (err3, row3) => {
        if (err3) return res.status(500).json({ message: 'Error fetching metrics' });
        counts.totalAllocations = row3 ? row3.total : 0;

        db.get('SELECT COUNT(*) AS total FROM Rooms WHERE current_occupancy < capacity', (err4, row4) => {
          if (err4) return res.status(500).json({ message: 'Error fetching metrics' });
          counts.vacantRooms = row4 ? row4.total : 0;

          db.get("SELECT COUNT(*) AS total FROM Complaints WHERE status = 'Pending'", (err5, row5) => {
            if (err5) return res.status(500).json({ message: 'Error fetching metrics' });
            counts.pendingComplaints = row5 ? row5.total : 0;

            db.get('SELECT COALESCE(SUM(amount), 0) AS total FROM Payments', (err6, row6) => {
              if (err6) return res.status(500).json({ message: 'Error fetching metrics' });
              counts.totalPayments = row6 ? row6.total : 0;
              res.json(counts);
            });
          });
        });
      });
    });
  });
});

// --------------------
// Hostel profile (branding + location)
// --------------------
app.get('/hostel/profile', (req, res) => {
  db.get('SELECT hostel_id, hostel_name, location, contact_email, logo_url FROM Hostels LIMIT 1', (err, row) => {
    if (err) {
      console.error('Error fetching hostel profile:', err.message);
      return res.status(500).json({ message: 'Error fetching hostel profile' });
    }
    if (!row) {
      return res.json({ hostel_name: "Your Hostel", location: "Pakistan", contact_email: "admin@example.com", logo_url: "" });
    }
    res.json(row);
  });
});

app.put('/hostel/profile', (req, res) => {
  const { errors, clean } = validateHostelPayload(req.body || {});
  if (errors.length) return res.status(400).json({ message: errors.join("; ") });

  db.get('SELECT hostel_id FROM Hostels LIMIT 1', (err, row) => {
    if (err) {
      console.error('Error fetching hostel profile:', err.message);
      return res.status(500).json({ message: 'Error updating hostel profile' });
    }

    const params = [clean.hostel_name, clean.location, clean.contact_email ?? "", clean.logo_url ?? ""];

    if (!row) {
      db.run(
        `INSERT INTO Hostels(hostel_name, location, contact_email, logo_url) VALUES (?, ?, ?, ?)`,
        params,
        function(insertErr) {
          if (insertErr) {
            console.error('Error creating hostel profile:', insertErr.message);
            return res.status(500).json({ message: 'Error saving hostel profile' });
          }
          res.json({ message: 'Hostel profile saved', hostel_id: this.lastID });
        }
      );
    } else {
      db.run(
        `UPDATE Hostels SET hostel_name = ?, location = ?, contact_email = ?, logo_url = ? WHERE hostel_id = ?`,
        [...params, row.hostel_id],
        function(updateErr) {
          if (updateErr) {
            console.error('Error updating hostel profile:', updateErr.message);
            return res.status(500).json({ message: 'Error saving hostel profile' });
          }
          res.json({ message: 'Hostel profile updated' });
        }
      );
    }
  });
});

app.get('/floors/overview', (req, res) => {
  db.all(
    `
      SELECT 
        floor_level,
        COUNT(*) AS rooms,
        SUM(capacity) AS beds,
        SUM(capacity - current_occupancy) AS vacancies,
        SUM(CASE WHEN wifi_available = 1 THEN 1 ELSE 0 END) AS wifi_rooms,
        ROUND(AVG(monthly_fee), 0) AS avg_fee,
        GROUP_CONCAT(DISTINCT room_type) AS room_types
      FROM Rooms
      GROUP BY floor_level
      ORDER BY floor_level
    `,
    (err, rows) => {
      if (err) {
        console.error('Error building floor overview:', err.message);
        return res.status(500).json({ message: 'Error building floor overview' });
      }

      if (!rows || !rows.length) {
        return res.json([]);
      }

      const normalized = rows.map((row) => {
        const types = (row.room_types || "")
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);

        return {
          floor: Number(row.floor_level) || 0,
          rooms: Number(row.rooms) || 0,
          beds: Number(row.beds) || 0,
          vacancies: Math.max(0, Number(row.vacancies) || 0),
          wifi_available: Number(row.wifi_rooms) > 0,
          avg_fee: Number(row.avg_fee) || 0,
          avg_capacity: row.rooms ? Math.round((Number(row.beds) || 0) / Number(row.rooms)) : 0,
          room_types: types.length ? types : ["Mixed"]
        };
      });

      res.json(normalized);
    }
  );
});

// Start server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));