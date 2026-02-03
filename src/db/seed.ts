import { query } from "./index";
import { v4 as uuid } from "uuid";

(async () => {
  const tenantId = uuid();
  const staffId = uuid();
  const serviceId = uuid();
  const addonId = uuid();

  await query(
    `INSERT INTO tenants (id, name, timezone)
     VALUES ($1,'Demo Nail Salon','America/Toronto')`,
    [tenantId]
  );

  await query(
    `INSERT INTO staff (id, tenant_id, name, active)
     VALUES ($1,$2,'Anna',true)`,
    [staffId, tenantId]
  );

  await query(
    `INSERT INTO services (id, tenant_id, name, duration_min, price_cents)
     VALUES ($1,$2,'Gel Manicure',45,4500)`,
    [serviceId, tenantId]
  );

  await query(
    `INSERT INTO addons (id, tenant_id, name, extra_duration_min, extra_price_cents)
     VALUES ($1,$2,'Nail Art (Simple)',15,1000)`,
    [addonId, tenantId]
  );

  await query(
    `INSERT INTO staff_services (staff_id, service_id)
     VALUES ($1,$2)`,
    [staffId, serviceId]
  );

  await query(
    `INSERT INTO staff_availability
     (id, staff_id, day_of_week, start_time, end_time)
     VALUES ($1,$2,1,'09:00','17:00')`,
    [uuid(), staffId]
  );

  console.log("✅ Seed data inserted");
  process.exit(0);
})();