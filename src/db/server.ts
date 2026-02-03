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

app.get("/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch {
    res.status(500).json({ status: "error", db: "disconnected" });
  }
});

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
    const serviceResult = await query<{
      duration_minutes: number;
    }>(
      "SELECT duration_minutes FROM services WHERE id = $1",
      [service_id]
    );

    if (serviceResult.rowCount === 0) {
      return res.status(404).json({ error: "Service not found" });
    }

    const duration = serviceResult.rows[0].duration_minutes;

    // 2️⃣ Calculate end time
    const start = new Date(start_time);
    const end = new Date(start.getTime() + duration * 60_000);

    // 🚨 3️⃣ OVERLAP CHECK (CORE LOGIC)
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

    if (overlapResult.rowCount ?? 0 > 0) {
      return res.status(409).json({
        error: "Time slot already booked",
      });
    }

    // 4️⃣ Insert booking
    const bookingResult = await query<{
      id: string;
    }>(
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

    res.status(201).json({
      booking_id: bookingResult.rows[0].id,
      status: "confirmed",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create booking" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});