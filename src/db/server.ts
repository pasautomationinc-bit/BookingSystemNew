import express from "express";
import cors from "cors";
import "dotenv/config";
import { query } from ".";

type CreateBookingInput = {
  service_id: string;
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
    date?: string; // YYYY-MM-DD
  };

  if (!service_id || !date) {
    return res.status(400).json({
      error: "service_id and date are required",
    });
  }

  try {
    // 1️⃣ Get service duration
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

    // 3️⃣ Existing bookings
    const bookingsResult = await query<{
      start_time: Date;
      end_time: Date;
    }>(
      `
      SELECT start_time, end_time
      FROM bookings
      WHERE service_id = $1
        AND start_time >= $2
        AND start_time < $3
        AND status = 'confirmed'
      `,
      [service_id, dayStart, dayEnd]
    );

    const bookings = bookingsResult.rows;

    // 4️⃣ Generate slots
    const slots: string[] = [];
    const slotStepMinutes = 15;

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

    res.json({
      date,
      service_id,
      slots,
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
    customer_name,
    customer_phone,
    start_time,
  } = req.body as CreateBookingInput;

  if (!service_id || !customer_name || !start_time) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // 1️⃣ Get service duration
    const serviceResult = await query<{ duration_minutes: number }>(
      "SELECT duration_minutes FROM services WHERE id = $1",
      [service_id]
    );

    if (serviceResult.rowCount === 0) {
      return res.status(404).json({ error: "Service not found" });
    }

    const duration = serviceResult.rows[0].duration_minutes;

    // 2️⃣ Calculate start/end
    const start = new Date(start_time);
    const end = new Date(start.getTime() + duration * 60_000);

    // 3️⃣ App-level overlap check
    const overlapResult = await query(
      `
      SELECT 1
      FROM bookings
      WHERE service_id = $1
        AND start_time < $2
        AND end_time   > $3
        AND status = 'confirmed'
      LIMIT 1
      `,
      [service_id, end, start]
    );

    if ((overlapResult.rowCount ?? 0) > 0) {
      return res.status(409).json({
        error: "Time slot already booked",
      });
    }

    // 4️⃣ Insert booking (DB constraint backs this up)
    const bookingResult = await query<{ id: string }>(
      `
      INSERT INTO bookings (
        service_id,
        customer_name,
        customer_phone,
        start_time,
        end_time
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
      `,
      [service_id, customer_name, customer_phone, start, end]
    );

    return res.status(201).json({
      booking_id: bookingResult.rows[0].id,
      status: "confirmed",
    });

  } catch (err: any) {
    // 🔒 Postgres EXCLUDE constraint violation
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