import express from "express";
import cors from "cors";
import "dotenv/config";
import { query } from ".";

type CreateBookingInput = {
  service_id: string;
  staff_id: string;
  customer_name: string;
  customer_phone?: string;
  start_time: string; // ISO string
};

const app = express();
app.use(cors());
app.use(express.json());

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

/* ---------------- AVAILABILITY ---------------- */

app.get("/availability", async (req, res) => {
  const { service_id, date } = req.query as {
    service_id?: string;
    date?: string;
  };

  if (!service_id || !date) {
    return res.status(400).json({
      error: "service_id and date are required",
    });
  }

  try {
    // 1️⃣ Service duration
    const serviceResult = await query<{ duration_minutes: number }>(
      "SELECT duration_minutes FROM services WHERE id = $1",
      [service_id]
    );

    if (serviceResult.rowCount === 0) {
      return res.status(404).json({ error: "Service not found" });
    }

    const duration = serviceResult.rows[0].duration_minutes;

    // 2️⃣ Business hours
    const dayStart = new Date(`${date}T09:00:00`);
    const dayEnd = new Date(`${date}T17:00:00`);
    const slotStepMinutes = 15;

    // 3️⃣ Active staff
    const staffResult = await query<{ id: string; name: string }>(
      "SELECT id, name FROM staff WHERE active = true"
    );

    const availability = [];

    for (const staff of staffResult.rows) {
      // 4️⃣ Staff bookings
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

      for (
        let slotStart = new Date(dayStart);
        slotStart.getTime() + duration * 60_000 <= dayEnd.getTime();
        slotStart = new Date(slotStart.getTime() + slotStepMinutes * 60_000)
      ) {
        const slotEnd = new Date(
          slotStart.getTime() + duration * 60_000
        );

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

    res.json({
      date,
      service_id,
      availability,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to calculate availability",
    });
  }
});

/* ---------------- BOOKINGS ---------------- */

app.post("/bookings", async (req, res) => {
  const {
    service_id,
    staff_id,
    customer_name,
    customer_phone,
    start_time,
  } = req.body as {
    service_id: string;
    staff_id?: string;
    customer_name: string;
    customer_phone?: string;
    start_time: string;
  };

  if (!service_id || !customer_name || !start_time) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // 1️⃣ Service duration
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

    // 2️⃣ AUTO-ASSIGN STAFF IF NOT PROVIDED
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

    // 3️⃣ Insert booking (DB constraint still protects)
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
        customer_name,
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