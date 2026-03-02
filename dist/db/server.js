"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
require("dotenv/config");
const _1 = require(".");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
/* ---------------- HEALTH ---------------- */
app.get("/health", async (_req, res) => {
    try {
        await (0, _1.query)("SELECT 1");
        res.json({ status: "ok", db: "connected" });
    }
    catch {
        res.status(500).json({ status: "error", db: "disconnected" });
    }
});
/* ---------------- SERVICES ---------------- */
app.get("/services", async (_req, res) => {
    try {
        const result = await (0, _1.query)("SELECT id, name, duration_minutes, price_cents FROM services ORDER BY created_at");
        res.json(result.rows);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch services" });
    }
});
/* ---------------- AVAILABILITY ---------------- */
app.get("/availability", async (req, res) => {
    const { service_id, date } = req.query;
    if (!service_id || !date) {
        return res.status(400).json({
            error: "service_id and date are required",
        });
    }
    try {
        // 1️⃣ Service duration
        const serviceResult = await (0, _1.query)("SELECT duration_minutes FROM services WHERE id = $1", [service_id]);
        if (serviceResult.rowCount === 0) {
            return res.status(404).json({ error: "Service not found" });
        }
        const duration = serviceResult.rows[0].duration_minutes;
        // 2️⃣ Business hours
        const dayStart = new Date(`${date}T09:00:00-05:00`);
        const dayEnd = new Date(`${date}T17:00:00-05:00`);
        const slotStepMinutes = 15;
        // 3️⃣ Active staff
        const staffResult = await (0, _1.query)("SELECT id, name FROM staff WHERE active = true");
        const availability = [];
        for (const staff of staffResult.rows) {
            // 4️⃣ Staff bookings
            const bookingsResult = await (0, _1.query)(`
        SELECT start_time, end_time
        FROM bookings
        WHERE staff_id = $1
          AND start_time >= $2
          AND start_time < $3
          AND status = 'confirmed'
        `, [staff.id, dayStart, dayEnd]);
            const bookings = bookingsResult.rows;
            const slots = [];
            for (let slotStart = new Date(dayStart); slotStart.getTime() + duration * 60000 <= dayEnd.getTime(); slotStart = new Date(slotStart.getTime() + slotStepMinutes * 60000)) {
                const slotEnd = new Date(slotStart.getTime() + duration * 60000);
                const overlaps = bookings.some((b) => b.start_time < slotEnd && b.end_time > slotStart);
                if (!overlaps) {
                    slots.push(slotStart.toISOString());
                }
            }
            availability.push({
                staff_id: staff.id,
                staff_name: staff.name,
                slots,
            });
        }
        res.json({
            date,
            service_id,
            availability,
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({
            error: "Failed to calculate availability",
        });
    }
});
/* ---------------- GET BOOKINGS ---------------- */
app.get("/bookings", async (req, res) => {
    const { date, staff_id, service_id, status } = req.query;
    // If date is missing, you can either require it OR default to today.
    // I recommend requiring it for clean API behavior.
    if (!date) {
        return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
    }
    // ⚠️ Timezone note:
    // This uses your server's timezone unless you add an offset.
    // If you want fixed timezone, use: ${date}T00:00:00-05:00
    const dayStart = new Date(`${date}T00:00:00-05:00`);
    const dayEnd = new Date(`${date}T23:59:59.999-05:00`);
    const bookingStatus = status ?? "confirmed";
    try {
        const conditions = [];
        const params = [];
        // date range
        params.push(dayStart);
        conditions.push(`b.start_time >= $${params.length}`);
        params.push(dayEnd);
        conditions.push(`b.start_time <= $${params.length}`);
        // status
        params.push(bookingStatus);
        conditions.push(`b.status = $${params.length}`);
        // optional staff filter
        if (staff_id) {
            params.push(staff_id);
            conditions.push(`b.staff_id = $${params.length}`);
        }
        // optional service filter
        if (service_id) {
            params.push(service_id);
            conditions.push(`b.service_id = $${params.length}`);
        }
        const sql = `
      SELECT
        b.id,
        b.service_id,
        s.name AS service_name,
        b.staff_id,
        st.name AS staff_name,
        b.customer_name,
        b.customer_phone,
        b.start_time,
        b.end_time,
        b.status,
        b.created_at
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      JOIN staff st ON st.id = b.staff_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY b.start_time ASC
    `;
        const result = await (0, _1.query)(sql, params);
        return res.json(result.rows);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to fetch bookings" });
    }
});
/* ---------------- BOOKINGS ---------------- */
app.post("/bookings", async (req, res) => {
    const { service_id, staff_id, customer_name, customer_phone, start_time, } = req.body;
    if (!service_id || !customer_name?.trim() || !start_time) {
        return res.status(400).json({ error: "Missing required fields" });
    }
    try {
        // 1️⃣ Service duration
        const serviceResult = await (0, _1.query)("SELECT duration_minutes FROM services WHERE id = $1", [service_id]);
        if (serviceResult.rowCount === 0) {
            return res.status(404).json({ error: "Service not found" });
        }
        const duration = serviceResult.rows[0].duration_minutes;
        const start = new Date(start_time);
        const end = new Date(start.getTime() + duration * 60000);
        let assignedStaffId = staff_id;
        // 2️⃣ AUTO-ASSIGN STAFF IF NOT PROVIDED
        if (!assignedStaffId) {
            const availableStaff = await (0, _1.query)(`
        SELECT s.id
        FROM staff s
        WHERE s.active = true
          AND NOT EXISTS (
            SELECT 1
            FROM bookings b
            WHERE b.staff_id = s.id
              AND b.start_time < $2
              AND b.end_time   > $1
              AND b.status = 'confirmed'
          )
        ORDER BY s.created_at
        LIMIT 1
        `, [start, end]);
            if (availableStaff.rowCount === 0) {
                return res.status(409).json({
                    error: "No staff available for this time slot",
                });
            }
            assignedStaffId = availableStaff.rows[0].id;
        }
        // 3️⃣ Insert booking (DB constraint still protects)
        const bookingResult = await (0, _1.query)(`
      INSERT INTO bookings (
        service_id,
        staff_id,
        customer_name,
        customer_phone,
        start_time,
        end_time
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
      `, [
            service_id,
            assignedStaffId,
            customer_name,
            customer_phone,
            start,
            end,
        ]);
        return res.status(201).json({
            booking_id: bookingResult.rows[0].id,
            staff_id: assignedStaffId,
            status: "confirmed",
        });
    }
    catch (err) {
        // 🔒 DB overlap protection
        if (err.code === "23P01") {
            return res.status(409).json({
                error: "Time slot already booked",
            });
        }
        console.error(err);
        return res.status(500).json({
            error: "Failed to create booking",
        });
    }
});
/* ---------------- SERVER ---------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
