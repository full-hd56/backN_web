import express, { type Request, type Response } from "express";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { conn } from "../dbconnect";

const router = express.Router();
const routingRouter = express.Router();

const DEPOT = { latitude: 16.2468, longitude: 103.252 };
const BOX_PRICE_THB = 65;
const BOX_COST_THB = 40;
const ORDER_STATUSES = ["PENDING", "ROUTING", "ASSIGNED", "COMPLETED", "CANCELLED"] as const;
type OrderStatus = (typeof ORDER_STATUSES)[number];

interface OrderRow extends RowDataPacket {
  id: number;
  customer_id: number;
  customer_name: string;
  phone: string;
  latitude: number;
  longitude: number;
  box_quantity: number;
  status: OrderStatus;
  created_at: Date | string;
}

interface OrderInput {
  customer_name: string;
  phone: string;
  latitude: number;
  longitude: number;
  box_quantity: number;
  status?: OrderStatus;
}

const orderSelect = `
  SELECT
    o.id, o.customer_id, c.name AS customer_name, c.phone, c.latitude, c.longitude,
    o.box_amount AS box_quantity,
    CASE WHEN o.status = 'DELIVERED' THEN 'COMPLETED' ELSE o.status END AS status,
    o.created_at
  FROM orders o
  INNER JOIN customers c ON c.id = o.customer_id`;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function asOrder(row: OrderRow) {
  const dist = haversineKm(DEPOT.latitude, DEPOT.longitude, Number(row.latitude), Number(row.longitude));
  return {
    id: String(row.id),
    customer_name: row.customer_name,
    phone: row.phone,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    box_quantity: Number(row.box_quantity),
    status: row.status,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    distance_from_depot_km: Number(dist.toFixed(2)),
  };
}

function parseId(param: unknown): number | null {
  const id = Number(param);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateOrderInput(body: unknown): { value?: OrderInput; error?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;
  const customer_name = typeof b.customer_name === "string" ? b.customer_name.trim() : "";
  const phone = typeof b.phone === "string" ? b.phone.trim() : "";
  const latitude = Number(b.latitude), longitude = Number(b.longitude), box_quantity = Number(b.box_quantity);

  if (!customer_name) return { error: "customer_name is required." };
  if (!phone) return { error: "phone is required." };
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return { error: "latitude must be a valid coordinate." };
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return { error: "longitude must be a valid coordinate." };
  if (!Number.isInteger(box_quantity) || box_quantity < 1 || box_quantity > 3) return { error: "box_quantity must be an integer from 1 to 3." };

  const res: OrderInput = { customer_name, phone, latitude, longitude, box_quantity };
  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !ORDER_STATUSES.includes(b.status as OrderStatus)) {
      return { error: "status is invalid." };
    }
    res.status = b.status as OrderStatus;
  }
  return { value: res };
}

function sendServerError(res: Response, error: unknown): void {
  console.error("Order API error:", error);
  res.status(500).json({ error: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Unexpected server error." });
}

async function withTx<T>(res: Response, fn: (connection: PoolConnection) => Promise<T>): Promise<T | void> {
  const connection = await conn.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    return sendServerError(res, error);
  } finally {
    connection.release();
  }
}

async function saveCustomer(connection: PoolConnection, input: OrderInput, existingCustomerId?: number): Promise<number> {
  let id = existingCustomerId;
  if (!id) {
    const [found] = await connection.execute<RowDataPacket[]>("SELECT id FROM customers WHERE phone = ? LIMIT 1", [input.phone]);
    id = found[0]?.["id"];
  }
  if (id) {
    await connection.execute(
      "UPDATE customers SET name = ?, phone = ?, latitude = ?, longitude = ? WHERE id = ?",
      [input.customer_name, input.phone, input.latitude, input.longitude, id],
    );
    return id;
  }
  const [result] = await connection.execute<ResultSetHeader>(
    "INSERT INTO customers (name, phone, address_detail, latitude, longitude) VALUES (?, ?, '', ?, ?)",
    [input.customer_name, input.phone, input.latitude, input.longitude],
  );
  return result.insertId;
}

async function fetchOrder(id: number): Promise<OrderRow | undefined> {
  const [rows] = await conn.execute<OrderRow[]>(`${orderSelect} WHERE o.id = ?`, [id]);
  return rows[0];
}

// ===== Orders Endpoints =====

router.get("/", async (req: Request, res: Response) => {
  try {
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    const rawStatus = typeof req.query["status"] === "string" ? req.query["status"].toUpperCase() : "";

    if (rawStatus) {
      if (!ORDER_STATUSES.includes(rawStatus as OrderStatus)) {
        return res.status(400).json({ error: "INVALID_STATUS", message: "status is invalid." });
      }
      clauses.push(rawStatus === "COMPLETED" ? "o.status IN ('COMPLETED', 'DELIVERED')" : "o.status = ?");
      if (rawStatus !== "COMPLETED") values.push(rawStatus);
    }

    const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : "";
    if (search) {
      clauses.push("(c.name LIKE ? OR c.phone LIKE ?)");
      values.push(`%${search}%`, `%${search}%`);
    }

    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";

    const limitParam = req.query["limit"];
    const pageParam = req.query["page"];
    let paginationSql = "";
    let total = 0;

    if (limitParam !== undefined) {
      const limit = Math.max(1, Math.min(1000, Number(limitParam) || 50));
      const page = Math.max(1, Number(pageParam) || 1);
      const offset = (page - 1) * limit;
      paginationSql = ` LIMIT ${limit} OFFSET ${offset}`;

      const [countRows] = await conn.execute<RowDataPacket[]>(
        `SELECT COUNT(*) as total FROM orders o JOIN customers c ON c.id = o.customer_id${where}`,
        values
      );
      total = Number(countRows[0]?.["total"] ?? 0);
    }

    const [rows] = await conn.execute<OrderRow[]>(
      `${orderSelect}${where} ORDER BY o.created_at DESC, o.id DESC${paginationSql}`,
      values
    );
    const data = rows.map(asOrder);
    return res.json({
      success: true,
      count: data.length,
      total: limitParam !== undefined ? total : data.length,
      data,
    });
  } catch (error) {
    return sendServerError(res, error);
  }
});

router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(CASE WHEN status <> 'CANCELLED' THEN box_amount ELSE 0 END), 0) AS total_boxes,
        SUM(status = 'PENDING') AS pending_orders,
        SUM(status = 'ROUTING') AS routing_orders,
        SUM(status = 'ASSIGNED') AS assigned_orders,
        SUM(status IN ('COMPLETED', 'DELIVERED')) AS completed_orders,
        SUM(status = 'CANCELLED') AS cancelled_orders
      FROM orders`);
    const s = (rows[0] as Record<string, unknown> | undefined) ?? {};
    const totalBoxes = Number(s["total_boxes"] ?? 0);
    const totalRevenue = totalBoxes * BOX_PRICE_THB;
    const totalCost = totalBoxes * BOX_COST_THB;

    return res.json({
      success: true,
      data: {
        total_orders: Number(s["total_orders"] ?? 0),
        total_boxes: totalBoxes,
        pending_orders: Number(s["pending_orders"] ?? 0),
        routing_orders: Number(s["routing_orders"] ?? 0),
        assigned_orders: Number(s["assigned_orders"] ?? 0),
        completed_orders: Number(s["completed_orders"] ?? 0),
        cancelled_orders: Number(s["cancelled_orders"] ?? 0),
        total_revenue_thb: totalRevenue,
        total_cost_thb: totalCost,
        gross_profit_thb: totalRevenue - totalCost,
      },
    });
  } catch (error) {
    return sendServerError(res, error);
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  const id = parseId(req.params["id"]);
  if (!id) return res.status(400).json({ error: "INVALID_ID", message: "Order id must be a positive integer." });

  try {
    const row = await fetchOrder(id);
    if (!row) return res.status(404).json({ error: "ORDER_NOT_FOUND", message: "Order not found." });
    return res.json({ success: true, data: asOrder(row) });
  } catch (error) {
    return sendServerError(res, error);
  }
});

router.post("/", async (req: Request, res: Response) => {
  const { value: input, error } = validateOrderInput(req.body);
  if (!input) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });

  await withTx(res, async (tx) => {
    const customerId = await saveCustomer(tx, input);
    const dbStatus = input.status === "COMPLETED" ? "DELIVERED" : input.status ?? "PENDING";
    const [result] = await tx.execute<ResultSetHeader>(
      "INSERT INTO orders (customer_id, box_amount, total_price, status) VALUES (?, ?, ?, ?)",
      [customerId, input.box_quantity, input.box_quantity * BOX_PRICE_THB, dbStatus],
    );
    const row = await fetchOrder(result.insertId);
    return res.status(201).json({ success: true, data: row ? asOrder(row) : { id: String(result.insertId), ...input, status: dbStatus } });
  });
});

router.put("/:id", async (req: Request, res: Response) => {
  const id = parseId(req.params["id"]);
  if (!id) return res.status(400).json({ error: "INVALID_ID", message: "Order id must be a positive integer." });

  const { value: input, error } = validateOrderInput(req.body);
  if (!input) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });

  await withTx(res, async (tx) => {
    const [existing] = await tx.execute<(RowDataPacket & { customer_id: number; status: string })[]>(
      "SELECT customer_id, status FROM orders WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!existing[0]) return res.status(404).json({ error: "ORDER_NOT_FOUND", message: "Order not found." });

    await saveCustomer(tx, input, existing[0].customer_id);
    const dbStatus = input.status ? (input.status === "COMPLETED" ? "DELIVERED" : input.status) : existing[0].status;
    await tx.execute(
      "UPDATE orders SET box_amount = ?, total_price = ?, status = ? WHERE id = ?",
      [input.box_quantity, input.box_quantity * BOX_PRICE_THB, dbStatus, id],
    );
    const row = await fetchOrder(id);
    return res.json({ success: true, data: row ? asOrder(row) : null });
  });
});

router.patch("/:id/cancel", async (req: Request, res: Response) => {
  const id = parseId(req.params["id"]);
  if (!id) return res.status(400).json({ error: "INVALID_ID", message: "Order id must be a positive integer." });

  try {
    await conn.execute("UPDATE orders SET status = 'CANCELLED' WHERE id = ? AND status <> 'CANCELLED'", [id]);
    const row = await fetchOrder(id);
    if (!row) return res.status(404).json({ error: "ORDER_NOT_FOUND", message: "Order not found." });
    return res.json({ success: true, data: asOrder(row) });
  } catch (error) {
    return sendServerError(res, error);
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const id = parseId(req.params["id"]);
  if (!id) return res.status(400).json({ error: "INVALID_ID", message: "Order id must be a positive integer." });

  try {
    const [result] = await conn.execute<ResultSetHeader>("DELETE FROM orders WHERE id = ?", [id]);
    if (!result.affectedRows) return res.status(404).json({ error: "ORDER_NOT_FOUND", message: "Order not found." });
    return res.json({ success: true, message: "Order deleted.", data: null });
  } catch (error) {
    return sendServerError(res, error);
  }
});

router.delete("/", async (_req: Request, res: Response) => {
  try {
    await conn.query("DELETE FROM orders");
    await conn.query("DELETE FROM customers WHERE name LIKE 'Mock Customer%'");
    return res.json({ success: true, message: "All orders deleted.", data: null });
  } catch (error) {
    return sendServerError(res, error);
  }
});

router.post("/mockup", async (req: Request, res: Response) => {
  const count = req.body?.count === undefined ? 25 : Number(req.body.count);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    return res.status(400).json({ error: "INVALID_COUNT", message: "count must be an integer from 1 to 100." });
  }

  await withTx(res, async (tx) => {
    const mockTimestamp = Date.now();
    const mockItems: Array<{
      name: string;
      phone: string;
      latitude: number;
      longitude: number;
      box_quantity: number;
    }> = [];

    const custValues: (string | number)[] = [];
    const custMarks: string[] = [];
    const phones: string[] = [];

    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radiusKm = Math.sqrt(Math.random()) * 2.9;
      const latitude = Number((DEPOT.latitude + (radiusKm * Math.cos(angle)) / 111.32).toFixed(6));
      const longitude = Number((DEPOT.longitude + (radiusKm * Math.sin(angle)) / (111.32 * Math.cos((DEPOT.latitude * Math.PI) / 180))).toFixed(6));
      const box_quantity = 1 + Math.floor(Math.random() * 3);
      const phone = `08${String(mockTimestamp).slice(-3)}${String(i).padStart(2, "0")}${Math.floor(100 + Math.random() * 900)}`;
      const name = `Mock Customer ${mockTimestamp.toString().slice(-4)}-${i + 1}`;

      mockItems.push({ name, phone, latitude, longitude, box_quantity });
      phones.push(phone);
      custValues.push(name, phone, "", latitude, longitude);
      custMarks.push("(?, ?, ?, ?, ?)");
    }

    // 1. Bulk insert customers in a single query
    await tx.execute(
      `INSERT INTO customers (name, phone, address_detail, latitude, longitude) VALUES ${custMarks.join(",")}`,
      custValues,
    );

    // 2. Fetch created customer ids in a single query
    const phoneMarks = phones.map(() => "?").join(",");
    const [custRows] = await tx.execute<(RowDataPacket & { id: number; phone: string })[]>(
      `SELECT id, phone FROM customers WHERE phone IN (${phoneMarks})`,
      phones,
    );
    const phoneToId = new Map(custRows.map((r) => [r.phone, r.id]));

    // 3. Bulk insert orders in a single query
    const orderValues: (number | string)[] = [];
    const orderMarks: string[] = [];
    const customerIds: number[] = [];

    for (const item of mockItems) {
      const cid = phoneToId.get(item.phone);
      if (cid) {
        customerIds.push(cid);
        orderValues.push(cid, item.box_quantity, item.box_quantity * BOX_PRICE_THB, "PENDING");
        orderMarks.push("(?, ?, ?, ?)");
      }
    }

    if (orderMarks.length) {
      await tx.execute(
        `INSERT INTO orders (customer_id, box_amount, total_price, status) VALUES ${orderMarks.join(",")}`,
        orderValues,
      );
    }

    // 4. Return the generated orders
    const cIdMarks = customerIds.map(() => "?").join(",");
    const [rows] = await tx.execute<OrderRow[]>(
      `${orderSelect} WHERE o.customer_id IN (${cIdMarks}) ORDER BY o.id`,
      customerIds,
    );
    return res.status(201).json({ success: true, count: rows.length, data: rows.map(asOrder) });
  });
});

// ===== Routing Trigger Endpoint =====

routingRouter.post("/trigger", async (_req: Request, res: Response) => {
  await withTx(res, async (tx) => {
    const [pending] = await tx.execute<OrderRow[]>(`${orderSelect} WHERE o.status = 'PENDING' ORDER BY o.created_at, o.id FOR UPDATE`);
    if (!pending.length) {
      return res.status(409).json({ error: "NO_PENDING_ORDERS", message: "ไม่มีออเดอร์สถานะ PENDING สำหรับจัดเส้นทาง" });
    }

    const ids = pending.map((r) => Number(r.id));
    const marks = ids.map(() => "?").join(",");
    await tx.execute(`UPDATE orders SET status = 'ROUTING' WHERE id IN (${marks})`, ids);

    const [rows] = await tx.execute<OrderRow[]>(`${orderSelect} WHERE o.id IN (${marks}) ORDER BY o.created_at, o.id`, ids);
    const data = rows.map(asOrder);
    const jobId = `JOB-${randomUUID()}`;
    return res.json({
      job_id: jobId,
      status: "QUEUED",
      triggered_at: new Date().toISOString(),
      total_orders_routed: data.length,
      total_boxes_routed: data.reduce((sum, o) => sum + o.box_quantity, 0),
      message: "Orders queued for route planning.",
      next_step_url: `/routes?jobId=${jobId}`,
      data,
    });
  });
});

export { router as ordersRouter, routingRouter };
