import express from "express";
import { conn } from "../dbconnect";
 
export const router = express.Router();
 
const start_point = { lat: 16.2468, lng: 103.252 }; // จุดเริ่ม = ร้าน (มมส. ขามเรียง)
const max_orders = 3;    // ใบงานละไม่เกิน 3 ออเดอร์
const speed_kmh = 30;    // ความเร็วไรเดอร์ (กม./ชม.)
const box_price = 65;    // ราคาขายต่อกล่อง
const box_cost = 40;     // ต้นทุนต่อกล่อง
const colors = [
  "#EF4444", "#16A34A", "#2563EB", "#EA580C", "#9333EA", "#0891B2","#DB2777", "#CA8A04", "#111827", "#7C2D12", "#65A30D", "#1E3A8A",]; // สีเส้นทาง
 
// ดูใบงานทั้งหมด  GET /api/delivery_tasks
router.get("/", async (req, res) => {
  try {
    const [rows]: any = await conn.query("SELECT * FROM delivery_tasks ORDER BY id DESC");
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.code, message: error.message });
  }
});

// ดูใบงานใบเดียว  ตัวอย่าง /api/delivery_tasks/TASK-20261019-01
router.get("/:task_number", async (req, res) => {
  try {
    // 1 หาใบงานจากเลขใบงาน
    const [tasks]: any = await conn.query(
      "SELECT * FROM delivery_tasks WHERE task_number = ?",
      [req.params.task_number]
    );
    if (tasks.length === 0) return res.status(404).json({ error: "ไม่พบใบงาน" });

    // 2 ดึงจุดส่งของใบงานนี้ + ข้อมูลออเดอร์ + ข้อมูลลูกค้า เรียงตามลำดับการส่ง
    const [items]: any = await conn.query(`
      SELECT ti.id, ti.stop_sequence, ti.delivery_status, ti.actual_arrival,
             o.id AS order_id, o.box_amount,
             c.name AS customer_name, c.phone, c.address_detail, c.latitude, c.longitude
      FROM task_items ti
      JOIN orders o ON o.id = ti.order_id
      JOIN customers c ON c.id = o.customer_id
      WHERE ti.task_id = ?
      ORDER BY ti.stop_sequence`,
      [tasks[0].id]
    );

    // 3 ส่งใบงาน พร้อมรายการจุดส่ง (items) กลับไป
    res.json({ ...tasks[0], items });
  } catch (error: any) {
    res.status(500).json({ error: error.code, message: error.message });
  }
});
// - task_items เก็บ order_id เต้อง JOIN orders และ customers เพื่อเอาชื่อ เบอร์ ที่อยู่ พิกัด
// - ti, o, c


// หาระยะทาง (กม.) ระหว่าง 2 จุด (สูตร Haversine)
function distance_km(a: any, b: any): number {
  const earth_radius = 6371; // รัศมีโลก (กม.)

  // ผลต่างของละติจูด และลองจิจูด (เป็นเรเดียน)
  const d_lat = to_radian(b.lat - a.lat);
  const d_lng = to_radian(b.lng - a.lng);

  // ละติจูดของทั้ง 2 จุด (เป็นเรเดียน)
  const lat1 = to_radian(a.lat);
  const lat2 = to_radian(b.lat);

  // สูตร Haversine
  const x = Math.sin(d_lat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(d_lng / 2) ** 2;
  const angle = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));

  return earth_radius * angle;
}
// รับพิกัด 2 จุด (a และ b) แต่ละจุดมี lat, lng แล้วคืนค่าระยะทางเป็นกิโลเมตร
// lat/lng เป็น "มุม" ไม่ใช่ระยะทาง สูตรนี้หาว่า 2 จุดห่างกันกี่องศาบนโลก (angle)
// แล้วคูณด้วยรัศมีโลก (6371 กม.) จะได้ระยะทางจริง: ระยะทาง = รัศมีโลก × มุม
// เป็นระยะ "เส้นตรง" บนผิวโลก ไม่ใช่ระยะตามถนนจริง
// ตัวอย่าง: distance_km(ร้าน, บ้านลูกค้า) ได้ 1.25 แปลว่าห่างกัน 1.25 กม.

// แปลงองศา เป็นเรเดียน
function to_radian(degree: number): number {
  return (degree * Math.PI) / 180;
}
// พิกัด lat/lng เก็บเป็น "องศา" เช่น 16.2468
// แต่ Math.sin / Math.cos ของ JavaScript รับค่าเป็น "เรเดียน"
// เลยต้องแปลงก่อน สูตร: เรเดียน = องศา × π ÷ 180
// ตัวอย่าง: to_radian(180) ได้ 3.14159... (π)
 
// หาออเดอร์ที่อยู่ใกล้จุดปัจจุบันที่สุด (คืนค่าเป็นลำดับใน array)
// หาออเดอร์ที่อยู่ใกล้จุดปัจจุบันที่สุด "ตามถนนจริง" (คืนค่าเป็นลำดับใน array)
// หาบ้านที่ใกล้ที่สุด "ตามถนนจริง"
// ส่งกลับ 2 อย่าง: index = บ้านหลังไหน, km = ห่างกี่กม.
async function find_nearest(current_point: any, orders: any[]) {
  let nearest = 0;
  try {
    // ถาม OSRM: จากจุดที่ยืนอยู่ ไปทุกบ้าน ตามถนนไกลเท่าไหร่
    const points = [current_point, ...orders];//เอาจุดที่ยืนอยู่ไว้หน้าสุด แล้วต่อด้วยบ้านทุกหลัง ... แตก array orders ออกมาต่อท้าย
                                              //ตัวอย่าง [ร้าน, บ้านA, บ้านB, บ้านC]
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
    const response = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=distance`);
    const data: any = await response.json();
    if (data.code !== "Ok") throw new Error("OSRM error");

    /*data = {
      code: "Ok",
      distances: [ [0, 900, 300, 500] ],
      ...
    }*/

    // road[0] = จุดที่อยู่ road[1] = บ้านแรก, road[2] = บ้านที่สอง ......
    const road = data.distances[0];
    for (let i = 0; i < orders.length; i++) {
      if (road[i + 1] < road[nearest + 1]) {
        nearest = i;
      }
    }
    return { index: nearest, km: road[nearest + 1] / 1000 }; //กม.
  } catch {
    // OSRM error ใช้ระยะเส้นตรงแบบเดิม
    nearest = 0;
    for (let i = 0; i < orders.length; i++) {
      if (distance_km(current_point, orders[i]) < distance_km(current_point, orders[nearest])) {
        nearest = i;
      }
    }
    return { index: nearest, km: distance_km(current_point, orders[nearest]) };
  }  // return index 
}


 
// จัดเส้นทาง + บันทึกใบงาน  POST /api/delivery_tasks/plan
/*   เริ่มที่ร้าน → ไปบ้านที่ใกล้ที่สุด → จากตรงนั้นไปบ้านที่ใกล้ที่สุดต่อ
   → ครบ 3 บ้านปิดใบงาน → เริ่มที่ร้านใหม่ ทำซ้ำจนออเดอร์หมด*/
router.post("/plan", async (req, res) => {
  try {
    //1 ดึงออเดอร์ที่ยังไม่มีใบงาน -----
    //เอาเฉพาะออเดอร์ที่ยังรอ (PENDING / ROUTING) 
    // JOIN กับ customers เพื่อเอาพิกัดบ้านลูกค้ามาด้วย
    //PENDING เพิ่งสั่ง รออยู่ ตอนเพิ่มออเดอร์, ROUTING ปิดรอบแล้ว รอจัดเส้นทาง ตอนกดปุ่มส่งเข้าระบบจัดเส้นทาง
    //ASSIGNED อยู่ในใบงานแล้ง  ตอน POST /plan จัดเส้นทางเสร็จ
    const [rows]: any = await conn.query(`
      SELECT o.id, o.box_amount, c.latitude, c.longitude
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.status IN ('PENDING', 'ROUTING')`);

    // ไม่มีออเดอร์รอเลย ไม่ต้องจัด จบตรงนี้
    if (rows.length === 0) return res.status(400).json({ error: "ไม่มีออเดอร์รอจัดเส้นทาง" });

    // แปลงเป็น "รายการรอส่ง" แต่ละตัวมี id, จำนวนกล่อง, พิกัด
    // (Number() เพราะค่าจาก database บางทีออกมาเป็นข้อความ)
    const waiting_orders = rows.map((r: any) => ({
      id: r.id,
      boxes: Number(r.box_amount),
      lat: Number(r.latitude),
      lng: Number(r.longitude),
    }));

    //2 เลขใบงานวันนี้ เช่น TASK-20261019-01
    // today  วันที่วันนี้ เช่น 20261019
    //const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }).replace(/-/g, "");

    // นับว่าวันนี้มีใบงานไปแล้วกี่ใบ จะได้ตั้งเลขต่อ ไม่ซ้ำ
    // เช่น มีแล้ว 2 ใบ  ใบถัดไปเป็น -03
    const [count]: any = await conn.query(
      "SELECT COUNT(*) AS total FROM delivery_tasks WHERE task_number LIKE ?",
      [`TASK-${today}-%`]
    );
    let task_count = Number(count[0].total);

    const result_tasks: any[] = []; // เก็บสรุปใบงานที่สร้าง ไว้ส่งกลับตอนท้าย

    // 3 ทำใบงานทีละใบ จนออเดอร์หมด 
    // ลูปนอก: 1 รอบ = 1 ใบงาน (วนจนรายการรอว่าง)
    while (waiting_orders.length > 0) {
      const task_orders: any[] = [];   // ออเดอร์ในใบงานนี้
      let current_point = start_point; // ทุกใบงานเริ่มที่ร้าน
      let total_km = 0;                // ระยะทางรวมของใบงานนี้

      // ลูปใน: 1 รอบ = เลือก 1 บ้าน (หยุดเมื่อครบ 3 บ้าน หรือไม่มีออเดอร์เหลือ)
      while (task_orders.length < max_orders && waiting_orders.length > 0) {
        // หาว่าบ้านไหนใกล้ "จุดที่ยืนอยู่ตอนนี้" ที่สุด (ตามถนนจริง)
        // nearest = { index: บ้านหลังไหน, km: ห่างกี่กม. }
        const nearest = await find_nearest(current_point, waiting_orders);

        // ดึงบ้านนั้นออกจากรายการรอ (จะได้ไม่ถูกเลือกซ้ำ)
        const next_order = waiting_orders.splice(nearest.index, 1)[0];

        total_km += nearest.km;          // บวกระยะทางที่วิ่งไป (ตามถนนจริง)
        task_orders.push(next_order);    // ใส่บ้านนั้นเข้าใบงาน
        current_point = next_order;      // ย้ายไปยืนที่บ้านนั้น แล้วหาบ้านถัดไปจากตรงนี้
      }

      //4 คำนวณตัวเลขของใบงาน -----
      task_count = task_count+1; // ใบงานใบใหม่
      const task_number = `TASK-${today}-${String(task_count).padStart(2, "0")}`; // padStart: 1 -> "01"

      const boxes = task_orders.reduce((sum, o) => sum + o.boxes, 0); // รวมกล่องทุกบ้านในใบงาน
      const km = Number(total_km.toFixed(2));                         // ปัดระยะทางเหลือทศนิยม 2 ตำแหน่ง
      const minutes = Math.round((km / speed_kmh) * 60);              // เวลาที่ใช้ส่ง (นาที) = กม. ÷ ความเร็ว × 60
      const fee = Number((15 + 2 * km * boxes).toFixed(2));           // ค่าส่ง = 15 + 2 × กม. × กล่อง
      const revenue = boxes * box_price;                              // รายได้ = กล่อง × 65
      const food_cost = boxes * box_cost;                             // ต้นทุนอาหาร = กล่อง × 40
      const profit = Number((revenue - food_cost - fee).toFixed(2));  // กำไร = รายได้ − ต้นทุน − ค่าส่ง (ติดลบ = ขาดทุน)
      const color = colors[(task_count - 1) % colors.length];         // สีเส้นทาง วนใช้ซ้ำถ้าใบงานเยอะกว่าจำนวนสี

      // 5 บันทึกใบงานลงตาราง delivery_tasks -----
      // สถานะ PROPOSED=จัดแล้ว แต่ยังไม่ส่ง
      const [task]: any = await conn.query(
        `INSERT INTO delivery_tasks
          (task_number, total_distance, estimated_minutes, total_boxes, delivery_fee,
           total_revenue, total_food_cost, net_profit, route_color, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED')`,
        [task_number, km, minutes, boxes, fee, revenue, food_cost, profit, color]
      );
      const task_id = task.insertId; // id ของใบงานที่ database เพิ่งสร้าง เอาไปผูกกับจุดส่งในขั้นที่ 6

      //6 บันทึกจุดส่งลงตาราง task_items -----
      // 1 บ้าน = 1 แถว, stop_sequence = ลำดับการส่ง (1, 2, 3) ตามที่เลือกในขั้นที่ 3
      for (let i = 0; i < task_orders.length; i++) {
        await conn.query(
          "INSERT INTO task_items (task_id, order_id, stop_sequence) VALUES (?, ?, ?)",
          [task_id, task_orders[i].id, i + 1] // i เริ่ม 0 แต่ลำดับการส่งเริ่ม 1 เลย +1
        );
      }
      //7 เปลี่ยนสถานะออเดอร์เป็น ASSIGNED 
      // แปลว่าอยู่ในใบงานแล้ว ถ้ากดจัดเส้นทางอีกรอบ จะไม่ถูกดึงมาซ้ำ)
      const order_ids = task_orders.map((o) => o.id); // เช่น [15, 23, 31]
      await conn.query("UPDATE orders SET status = 'ASSIGNED' WHERE id IN (?)", [order_ids]);

      // สรุปใบงาน
      result_tasks.push({ id: task_id, task_number, boxes, km, minutes, profit });
    }
    // จัดครบทุกออเดอร์แล้ว
    res.status(201).json({ count: result_tasks.length, tasks: result_tasks });
  } catch (error: any) {
    res.status(500).json({ error: error.code, message: error.message });
  }
});


// ไรเดอร์กด ส่งแล้ว  PATCH /api/delivery_tasks/items/1/delivered
// ไรเดอร์กด ส่งแล้ว  PATCH /api/delivery_tasks/items/1/delivered
// กดส่งหมด delivery_task  status เปลียน
router.patch("/items/:id/delivered", async (req, res) => {
  try {
    //  เวลาไทย
    const now_time = new Date().toLocaleTimeString("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit",
    });

    //  เกิน 12:30 ส่งช้า
    const status = now_time > "12:30" ? "LATE" : "DELIVERED";

    // บันทึกสถานะและเวลาที่กดส่ง (เฉพาะจุดที่ยังไม่ส่ง กันกดซ้ำ)
    const [result]: any = await conn.query(
      "UPDATE task_items SET delivery_status = ?, actual_arrival = NOW() WHERE id = ? AND delivery_status = 'PENDING'",
      [status, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(400).json({ error: "ไม่พบจุดส่ง หรือส่งไปแล้ว" });

    // ออเดอร์ของจุดส่งนี้ เปลี่ยนเป็นส่งแล้ว หน้า orders จะขึ้น จัดส่งสำเร็จ
    await conn.query(
      "UPDATE orders SET status = 'DELIVERED' WHERE id = (SELECT order_id FROM task_items WHERE id = ?)",
      [req.params.id]
    );

    // ใบงานส่ง order ครบ
    await conn.query(
      `UPDATE delivery_tasks SET status = 'DELIVERED'
       WHERE id = (SELECT task_id FROM task_items WHERE id = ?)
       AND NOT EXISTS (SELECT 1 FROM task_items WHERE task_id = delivery_tasks.id AND delivery_status = 'PENDING')`,
      [req.params.id]
    );

    res.json({ id: req.params.id, delivery_status: status, time: now_time });
  } catch (error: any) {
    res.status(500).json({ error: error.code, message: error.message });
  }
});
// :id คือ id ของจุดส่ง task_items.id ไม่ใช่ id ออเดอร์