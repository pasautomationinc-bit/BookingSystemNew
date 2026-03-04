import express from "express";
import cors from "cors";
import "dotenv/config";
import path from "path";

import { query } from ".";
import { createHold } from "../services/booking.service";

type CreateBookingInput = {
  service_id: string;
  staff_id?: string;
  customer_name: string;
  customer_phone?: string;
  start_time: string; // ISO string
};

const app = express();
app.use(cors());
app.use(express.json());

/* ---------------- ADMIN PAGE ---------------- */
app.get("/admin", (_req, res) => {
  const filePath = path.join(process.cwd(), "src", "db", "admin.html");
  res.sendFile(filePath);
});

/* ---------------- HEALTH ---------------- */

app.get("/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch {
    res.status(500).json({ status: "error", db: "disconnected" });
  }
});

/* ---------------- SERVICES ---------------- */

app.get("/services", async (_req, res) => {
  try {
    const result = await query(
      "SELECT id, name, duration_minutes, price_cents FROM services ORDER BY created_at"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

/* ---------------- ADMIN SERVICES ---------------- */

app.post("/admin/services", async (req, res) => {
  const { name, duration_minutes, price_cents } = req.body as {
    name?: string;
    duration_minutes?: number;
    price_cents?: number;
  };

  if (!name?.trim() || !duration_minutes) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const result = await query(
      `INSERT INTO services (name, duration_minutes, price_cents)
       VALUES ($1,$2,$3)
       RETURNING id, name, duration_minutes, price_cents`,
      [name.trim(), duration_minutes, price_cents ?? 0]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create service" });
  }
});

app.put("/admin/services/:id", async (req, res) => {
  const { id } = req.params;
  const { name, duration_minutes, price_cents } = req.body as {
    name?: string;
    duration_minutes?: number;
    price_cents?: number;
  };

  try {
    const result = await query(
      `UPDATE services
       SET name = COALESCE($1,name),
           duration_minutes = COALESCE($2,duration_minutes),
           price_cents = COALESCE($3,price_cents)
       WHERE id = $4
       RETURNING id, name, duration_minutes, price_cents`,
      [name?.trim() || null, duration_minutes ?? null, price_cents ?? null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Service not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update service" });
  }
});

/* ---------------- STAFF ---------------- */

app.get("/staff", async (_req, res) => {
  try {
    const result = await query(
      "SELECT id, name FROM staff WHERE active = true ORDER BY created_at"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch staff" });
  }
});

/* ---------------- ADMIN STAFF ---------------- */

app.post("/admin/staff", async (req, res) => {
  const { name } = req.body as { name?: string };

  if (!name?.trim()) {
    return res.status(400).json({ error: "Name required" });
  }

  try {
    const result = await query(
      `INSERT INTO staff (name, active)
       VALUES ($1, true)
       RETURNING id, name, active`,
      [name.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create staff" });
  }
});

app.put("/admin/staff/:id", async (req, res) => {
  const { id } = req.params;
  const { name, active } = req.body as { name?: string; active?: boolean };

  try {
    const result = await query(
      `UPDATE staff
       SET name = COALESCE($1, name),
           active = COALESCE($2, active)
       WHERE id = $3
       RETURNING id, name, active`,
      [name?.trim() || null, typeof active === "boolean" ? active : null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Staff not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update staff" });
  }
});

/* ---------------- ADMIN STAFF AVAILABILITY ---------------- */

app.get("/admin/staff/:id/availability", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await query(
      `SELECT day_of_week, start_time, end_time
       FROM staff_availability
       WHERE staff_id = $1
       ORDER BY day_of_week`,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch availability" });
  }
});

app.put("/admin/staff/:id/availability", async (req, res) => {
  const { id } = req.params;
  const availability = req.body as Array<{
    day_of_week: number;
    start_time: string;
    end_time: string;
  }>;

  if (!Array.isArray(availability)) {
    return res.status(400).json({ error: "Body must be an array" });
  }

  for (const a of availability) {
    if (
      typeof a.day_of_week !== "number" ||
      !a.start_time ||
      !a.end_time
    ) {
      return res.status(400).json({
        error: "Each entry must have day_of_week, start_time, end_time",
      });
    }
  }

  try {
    await query(`DELETE FROM staff_availability WHERE staff_id = $1`, [id]);

    for (const a of availability) {
      await query(
        `INSERT INTO staff_availability (staff_id, day_of_week, start_time, end_time)
         VALUES ($1,$2,$3,$4)`,
        [id, a.day_of_week, a.start_time, a.end_time]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update availability" });
  }
});

/* ---------------- AVAILABILITY ----------------
   Uses staff_availability per staff per day_of_week.
   Optional: staff_id filter.
*/
app.get("/availability", async (req, res) => {
  const { service_id, date, staff_id } = req.query as {
    service_id?: string;
    date?: string;        // YYYY-MM-DD
    staff_id?: string;    // optional
  };

  if (!service_id || !date) {
    return res.status(400).json({
      error: "service_id and date are required",
    });
  }

  try {
    // 1) Service duration
    const serviceResult = await query<{ duration_minutes: number }>(
      "SELECT duration_minutes FROM services WHERE id = $1",
      [service_id]
    );

    if (serviceResult.rowCount === 0) {
      return res.status(404).json({ error: "Service not found" });
    }

    const duration = serviceResult.rows[0].duration_minutes;
    const slotStepMinutes = 15;

    // 2) Staff list (active, optional filter)
    const staffResult = await query<{ id: string; name: string }>(
      staff_id
        ? "SELECT id, name FROM staff WHERE active = true AND id = $1"
        : "SELECT id, name FROM staff WHERE active = true ORDER BY created_at",
      staff_id ? [staff_id] : []
    );

    // 3) Day-of-week (Postgres: 0=Sun ... 6=Sat)
    const dowResult = await query<{ dow: number }>(
      `SELECT EXTRACT(DOW FROM DATE $1) as dow`,
      [date]
    );
    const dow = Number(dowResult.rows[0]?.dow);

    const availability: Array<{
      staff_id: string;
      staff_name: string;
      slots: string[];
    }> = [];

    for (const staff of staffResult.rows) {
      // 4) Get this staff's working hours for that day
      const hoursResult = await query<{ start_time: string; end_time: string }>(
        `
        SELECT start_time, end_time
        FROM staff_availability
        WHERE staff_id = $1
          AND day_of_week = $2
        LIMIT 1
        `,
        [staff.id, dow]
      );

      // If no hours set for that day -> no slots
      if (hoursResult.rowCount === 0) {
        availability.push({
          staff_id: staff.id,
          staff_name: staff.name,
          slots: [],
        });
        continue;
      }

      const { start_time, end_time } = hoursResult.rows[0];

      // Build local-ish dayStart/dayEnd with fixed -05:00 offset (your current pattern)
      const dayStart = new Date(`${date}T${start_time}-05:00`);
      const dayEnd = new Date(`${date}T${end_time}-05:00`);

      // 5) Existing confirmed bookings inside that window
      const bookingsResult = await query<{
        start_time: Date;
        end_time: Date;
      }>(
        `
        SELECT start_time, end_time
        FROM bookings
        WHERE staff_id = $1
          AND start_time >= $2
          AND start_time < $3
          AND status = 'confirmed'
        `,
        [staff.id, dayStart, dayEnd]
      );

      const bookings = bookingsResult.rows;
      const slots: string[] = [];

      // 6) Generate slots
      for (
        let slotStart = new Date(dayStart);
        slotStart.getTime() + duration * 60_000 <= dayEnd.getTime();
        slotStart = new Date(slotStart.getTime() + slotStepMinutes * 60_000)
      ) {
        const slotEnd = new Date(slotStart.getTime() + duration * 60_000);

        const overlaps = bookings.some(
          (b) => b.start_time < slotEnd && b.end_time > slotStart
        );

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

    res.json({ date, service_id, availability });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to calculate availability",
    });
  }
});

/* ---------------- GET BOOKINGS ---------------- */

app.get("/bookings", async (req, res) => {
  const { date, staff_id, service_id, status } = req.query as {
    date?: string; // YYYY-MM-DD
    staff_id?: string;
    service_id?: string;
    status?: string;
  };

  if (!date) {
    return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
  }

  const dayStart = new Date(`${date}T00:00:00-05:00`);
  const dayEnd = new Date(`${date}T23:59:59.999-05:00`);

  const bookingStatus = status ?? "confirmed";

  try {
    const conditions: string[] = [];
    const params: any[] = [];

    params.push(dayStart);
    conditions.push(`b.start_time >= $${params.length}`);

    params.push(dayEnd);
    conditions.push(`b.start_time <= $${params.length}`);

    params.push(bookingStatus);
    conditions.push(`b.status = $${params.length}`);

    if (staff_id) {
      params.push(staff_id);
      conditions.push(`b.staff_id = $${params.length}`);
    }

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

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

/* ---------------- BOOKINGS ---------------- */

app.post("/bookings", async (req, res) => {
  const body = req.body as CreateBookingInput;

  const { service_id, staff_id, customer_name, customer_phone, start_time } = body;

  if (!service_id || !customer_name?.trim() || !start_time) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const serviceResult = await query<{ duration_minutes: number }>(
      "SELECT duration_minutes FROM services WHERE id = $1",
      [service_id]
    );

    if (serviceResult.rowCount === 0) {
      return res.status(404).json({ error: "Service not found" });
    }

    const duration = serviceResult.rows[0].duration_minutes;

    const start = new Date(start_time);
    const end = new Date(start.getTime() + duration * 60_000);

    let assignedStaffId = staff_id;

    // AUTO-ASSIGN STAFF IF NOT PROVIDED
    if (!assignedStaffId) {
      const availableStaff = await query<{ id: string }>(
        `
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
        `,
        [start, end]
      );

      if (availableStaff.rowCount === 0) {
        return res.status(409).json({
          error: "No staff available for this time slot",
        });
      }

      assignedStaffId = availableStaff.rows[0].id;
    }

    const bookingResult = await query<{ id: string }>(
      `
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
      `,
      [
        service_id,
        assignedStaffId,
        customer_name.trim(),
        customer_phone,
        start,
        end,
      ]
    );

    return res.status(201).json({
      booking_id: bookingResult.rows[0].id,
      staff_id: assignedStaffId,
      status: "confirmed",
    });
  } catch (err: any) {
    // DB overlap protection (if you have exclusion constraint)
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

/* ---------------- CANCEL BOOKING ---------------- */

app.delete("/admin/bookings/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await query(
      `UPDATE bookings
       SET status = 'cancelled'
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to cancel booking" });
  }
});

/* ---------------- HOLDS ---------------- */

app.post("/holds", async (req, res) => {
  try {
    const { tenant_id, staff_id, start_at, end_at, total_price_cents } =
      req.body as {
        tenant_id: string;
        staff_id: string;
        start_at: string;
        end_at: string;
        total_price_cents: number;
      };

    if (!tenant_id || !staff_id || !start_at || !end_at || !total_price_cents) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await createHold(
      tenant_id,
      staff_id,
      new Date(start_at),
      new Date(end_at),
      total_price_cents
    );

    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(409).json({
      error: err.message || "Failed to create hold",
    });
  }
});

/* ---------------- SERVER ---------------- */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});