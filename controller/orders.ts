import express from "express";
import { conn } from "../dbconnect";
import { Order } from "../model/order";

const router = express.Router();        //เส้นเกี่ยวกับออเดอร์: GET, POST, PUT, DELETE
//const routingRouter = express.Router(); //เส้นจัดเส้นทาง /trigger

const BOX_PRICE = 65; // ราคาขายต่อกล่อง
const BOX_COST = 40;  // ต้นทุนต่อกล่อง

// ใน DB เก็บสถานะส่งแล้วเป็น DELIVERED แต่หน้าเว็บใช้คำว่า COMPLETED

// พิกัดใน DB ออกมาเป็นข้อความ แปลงเป็นตัวเลขก่อนส่งให้หน้าเว็บ
function toNumber(rows: any[]) {
    return rows.map((r) => ({ ...r, latitude: Number(r.latitude), longitude: Number(r.longitude) }));
}

// ดูออเดอร์ทั้งหมด  GET /api/orders  (กรองได้ ?status=PENDING&search=สมชาย)
router.get("/", async (req, res) => {
    try {
        let sql = `
  SELECT
    CAST(o.id AS CHAR) AS id,
    o.customer_id,
    c.name AS customer_name,
    c.phone,
    c.latitude,
    c.longitude,
    o.box_amount AS box_quantity,
    IF(o.status = 'DELIVERED', 'COMPLETED', o.status) AS status,
    o.created_at
  FROM orders o
  JOIN customers c ON c.id = o.customer_id` + " WHERE 1=1";
        const params: any[] = [];

        if (req.query.status) {
            sql += " AND o.status = ?";
            params.push(req.query.status === "COMPLETED" ? "DELIVERED" : req.query.status);
        }
        if (req.query.search) {
            sql += " AND (c.name LIKE ? OR c.phone LIKE ?)";
            params.push(`%${req.query.search}%`, `%${req.query.search}%`);
        }
        sql += " ORDER BY o.id DESC";

        const [rows]: any = await conn.query(sql, params);
        res.json({ success: true, count: rows.length, data: toNumber(rows) });
    } catch (error: any) {
        res.status(500).json({ error: error.code, message: error.message });
    }
});

// สรุปยอด  GET /api/orders/stats
router.get("/stats", async (req, res) => {
    try {
        const [rows]: any = await conn.query(`
      SELECT
        COUNT(*) AS total_orders,
        IFNULL(SUM(IF(status <> 'CANCELLED', box_amount, 0)), 0) AS total_boxes,
        IFNULL(SUM(IF(status = 'DELIVERED', box_amount, 0)), 0) AS delivered_boxes,
        IFNULL(SUM(status = 'PENDING'), 0)   AS pending_orders,
        IFNULL(SUM(status = 'ROUTING'), 0)   AS routing_orders,
        IFNULL(SUM(status = 'ASSIGNED'), 0)  AS assigned_orders,
        IFNULL(SUM(status = 'DELIVERED'), 0) AS completed_orders,
        IFNULL(SUM(status = 'CANCELLED'), 0) AS cancelled_orders
      FROM orders`);

        const s = rows[0];
        const boxes = Number(s.total_boxes);
        // ยอดขาย/กำไร นับเฉพาะกล่องที่ไรเดอร์กด "ส่งสำเร็จ" แล้ว (ออเดอร์ DELIVERED)
        const delivered_boxes = Number(s.delivered_boxes);

        res.json({
            success: true,
            data: {
                total_orders: Number(s.total_orders),
                total_boxes: boxes,
                pending_orders: Number(s.pending_orders),
                routing_orders: Number(s.routing_orders),
                assigned_orders: Number(s.assigned_orders),
                completed_orders: Number(s.completed_orders),
                cancelled_orders: Number(s.cancelled_orders),
                delivered_boxes: delivered_boxes,
                total_revenue_thb: delivered_boxes * BOX_PRICE,
                total_cost_thb: delivered_boxes * BOX_COST,
                gross_profit_thb: delivered_boxes * (BOX_PRICE - BOX_COST),
            },
        });
    } catch (error: any) {
        res.status(500).json({ error: error.code, message: error.message });
    }
});

// ดูออเดอร์เดียว  GET /api/orders/5
router.get("/:id", async (req, res) => {
    try {
        const [rows]: any = await conn.query(`
  SELECT
    CAST(o.id AS CHAR) AS id,
    o.customer_id,
    c.name AS customer_name,
    c.phone,
    c.latitude,
    c.longitude,
    o.box_amount AS box_quantity,
    IF(o.status = 'DELIVERED', 'COMPLETED', o.status) AS status,
    o.created_at
  FROM orders o
  JOIN customers c ON c.id = o.customer_id` + " WHERE o.id = ?", [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: "ไม่พบออเดอร์" });

        res.json({ success: true, data: toNumber(rows)[0] });
    } catch (error: any) {
        res.status(500).json({ error: error.code, message: error.message });
    }
});

// เพิ่มออเดอร์  POST /api/orders
// body: { customer_name, phone, latitude, longitude, box_quantity }
router.post("/", async (req, res) => {
    try {
        //const body = req.body;
        const body: Order = req.body;
        if (!body.customer_id) return res.status(400).json({ error: "กรุณาเลือกลูกค้า" });
        if (body.box_quantity < 1 || body.box_quantity > 3) return res.status(400).json({ error: "จำนวนกล่องต้อง 1-3" });

        const customerId = body.customer_id;

        const [result]: any = await conn.query(
            "INSERT INTO orders (customer_id, box_amount, total_price, status) VALUES (?, ?, ?, 'PENDING')",
            [customerId, body.box_quantity, body.box_quantity * BOX_PRICE]
        );

        res.status(201).json({ success: true, data: { id: String(result.insertId) } });
    } catch (error: any) {
        res.status(500).json({ error: error.code, message: error.message });
    }
});

// แก้ไขออเดอร์  PUT /api/orders/5
router.put("/:id", async (req, res) => {
    try {
        //const body = req.body;
        const body: Order = req.body;
        if (body.box_quantity < 1 || body.box_quantity > 3) return res.status(400).json({ error: "จำนวนกล่องต้อง 1-3" });

        const customerId = body.customer_id;

        const [result]: any = await conn.query(
            "UPDATE orders SET customer_id = ?, box_amount = ?, total_price = ? WHERE id = ?",
            [customerId, body.box_quantity, body.box_quantity * BOX_PRICE, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: "ไม่พบออเดอร์" });

        res.json({ success: true, data: { id: req.params.id } });
    } catch (error: any) {
        res.status(500).json({ error: error.code, message: error.message });
    }
});

// ยกเลิกออเดอร์  PATCH /api/orders/5/cancel
router.patch("/:id/cancel", async (req, res) => {
    try {
        await conn.query("UPDATE orders SET status = 'CANCELLED' WHERE id = ?", [req.params.id]);
        res.json({ success: true, data: { id: req.params.id } });
    } catch (error: any) {
        res.status(500).json({ error: error.code, message: error.message });
    }
});

// ลบออเดอร์  DELETE /api/orders/5
router.delete("/:id", async (req, res) => {
    try {
        const [result]: any = await conn.query("DELETE FROM orders WHERE id = ?", [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: "ไม่พบออเดอร์" });

        res.json({ success: true, data: null });
    } catch (error: any) {
        res.status(500).json({ error: error.code, message: error.message });
    }
});

// ลบออเดอร์ทั้งหมด + ลูกค้าปลอม  DELETE /api/orders
router.delete("/", async (req, res) => {
    try {
        await conn.query("DELETE FROM delivery_tasks"); // ลบใบงาน task_items ถูกลบตาม
        await conn.query("DELETE FROM orders");
        await conn.query("DELETE FROM customers WHERE name LIKE 'Mock Customer%'");
        res.json({ success: true, data: null });
    } catch (error: any) {
        res.status(500).json({ error: error.code, message: error.message });
    }
});

// สร้างข้อมูลปลอม  POST /api/orders/mockup  body: { count: 10 }
router.post("/mockup", async (req, res) => {
    try {
        //const count = Number(req.body?.count) || 10;
        const count = Number(req.body?.count) || 20 + Math.floor(Math.random() * 11); // สุ่ม 20-30 ออเดอร์

        for (let i = 1; i <= count; i++) {
            const fake = {
                customer_name: `Mock Customer ${i}`,
                phone: "08" + Math.floor(10000000 + Math.random() * 90000000), // เบอร์สุ่ม 10 หลัก
                latitude: 16.2468 + (Math.random() - 0.5) * 0.04,             // สุ่มรอบๆ มมส.
                longitude: 103.252 + (Math.random() - 0.5) * 0.04,
            };
            const boxes = Math.floor(Math.random() * 3) + 1; // 1-3 กล่อง

            const [newCustomer]: any = await conn.query(
                "INSERT INTO customers (name, phone, address_detail, latitude, longitude) VALUES (?, ?, '', ?, ?)",
                [fake.customer_name, fake.phone, fake.latitude, fake.longitude]
            );
            const customerId = newCustomer.insertId;
            await conn.query(
                "INSERT INTO orders (customer_id, box_amount, total_price, status) VALUES (?, ?, ?, 'PENDING')",
                [customerId, boxes, boxes * BOX_PRICE]
            );
        }

        res.status(201).json({ success: true, count: count, data: [] });
    } catch (error: any) {
        res.status(500).json({ error: error.code, message: error.message });
    }
});

export { router as ordersRouter };