import express from "express";
import { conn } from "../dbconnect";
//import { Trip } from "../model/trip";
import { Customer } from "../model/customer";
/*import { DeliveryTask } from "../model/deliveryTask"
import { Order } from "../model/order";
import { Rider } from "../model/rider";
import { TaskItem } from "../model/taskItem";*/

export const router = express.Router();

router.get("/", async (req, res) => {
    const [rows] = await conn.query("SELECT * FROM Customer");
    const trips = rows as Customer [];
    res.status(200);
    res.json(trips);
    //res.send(rows);
});


//insert ลูกค้า
router.post("/", async (req, res) => {
  try {
    const customer: Customer = req.body;

    const sql =
      "INSERT INTO `customers`(`name`, `phone`, `address_detail`, `latitude`, `longitude`) VALUES (?,?,?,?,?)";

    const [result]: any = await conn.query(sql, [
      customer.name,
      customer.phone,
      customer.address_detail,
      customer.latitude,
      customer.longitude,
    ]);

    res.status(201).json({
      affected_row: result.affectedRows,
      last_idx: result.insertId,
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.code, message: error.message });
  }
});

/*router.get("/", async (req, res) => {
    const [rows] = await conn.query("SELECT * FROM trip");
    const trips = rows as Trip [];
    res.status(200);
    res.json(trips);
    //res.send(rows);
});

router.get("/:idx", async (req, res) => {
  // ใช้เครื่องหมาย ? (Placeholder) เสมอ เพื่อส่งตัวแปรไปแทนค่าในคำสั่ง SQL ป้องกันภัยความปลอดภัย SQL Injection
  const [rows] = await conn.query("SELECT * FROM trip WHERE idx = ?", [
    req.params.idx,
  ]);
  res.json(rows);
});

router.get("/search/fields", async (req, res) => {
  try {
    const [rows] = await conn.query(
      "SELECT * FROM trip WHERE (idx IS NULL OR idx = ?) OR (name IS NULL OR name LIKE ?)",
      [req.query.id, "%" + req.query.name + "%"]
    );
    res.json(rows);
  } catch (error) {
    // ดักจับ Error กรณีทำงานผิดพลาด เพื่อไม่ให้ระบบหลังบ้านพังล่มไปดื้อๆ
    res.status(500).json({ error: "Internal server error" });
  }
});


router.post("/", async (req, res) => {
  try {
    let trip: Trip = req.body;
    console.log(req.body);
    
    let sql =
      "INSERT INTO `trip`(`name`, `country`, `destinationid`, `coverimage`, `detail`, `price`, `duration`) VALUES (?,?,?,?,?,?,?)";
      
    const [result] = await conn.query(sql, [
      trip.name,
      trip.country,
      trip.destinationid,
      trip.coverimage,
      trip.detail,
      trip.price,
      trip.duration,
    ]);
    
    // แปลงผลลัพธ์เพื่อนำมาสกัดหาข้อมูลแถวที่ทำรายการสำเร็จ
    const insertResult = result as any;
    res.status(201).json({
      affected_row: insertResult.affectedRows, // จำนวนแถวที่ได้รับผลกระทบ (สำเร็จ = 1)
      last_idx: insertResult.insertId // รหัสไอดีล่าสุดที่ระบบสร้างขึ้นให้อัตโนมัติ (Auto increment id)
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    let id = req.params.id;
    const [result] = await conn.query("DELETE FROM trip WHERE idx = ?", [id]);
    const deleteResult = result as any;
    
    // ตรวจเช็กสักนิดว่ามีแถวถูกลบจริงไหม หากไม่มีแสดงว่าไม่พบไอดีในฐานข้อมูล ส่งกลับรหัส 404
    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ error: "Trip not found" });
    }
    
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});


router.put("/:id", async (req, res) => {
  try {
    let id = req.params.id;
    let trip: Trip = req.body;
    let sql =
      "UPDATE `trip` SET `name`=?, `country`=?, `destinationid`=?, `coverimage`=?, `detail`=?, `price`=?, `duration`=? WHERE `idx`=?";
      
    const [result] = await conn.query(sql, [
      trip.name,
      trip.country,
      trip.destinationid,
      trip.coverimage,
      trip.detail,
      trip.price,
      trip.duration,
      id,
    ]);
    const updateResult = result as any;
    
    // หากไม่พบไอดีที่จะอัปเดต ส่งรหัส 404 กลับทันที
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: "Trip not found" });
    }
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  let id = +req.params.id; // แปลง id จากข้อความตัวอักษรให้เป็นตัวเลขด้วยสัญลักษณ์ + ข้างหน้า
  let trip: Trip = req.body;

  // 1. ค้นหาข้อมูลเก่าจากไอดีที่ต้องการอัปเดตก่อน
  let sql = conn.format("SELECT * FROM trip WHERE idx = ?", [id]);
  let [response] = await conn.query(sql);
  let result = response as Trip[];

  if (result.length > 0) {
    let tripOriginal = result[0];

    // 2. นำข้อมูลเก่ามาทับด้วยข้อมูลใหม่ที่ส่งมา (ค่าไหนไม่ส่งมาก็จะใช้ค่าเก่าของเดิม)
    let updateTrip = { ...tripOriginal, ...trip };

    // 3. เขียนข้อมูลที่รวมสำเร็จแล้วกลับลงไปในฐานข้อมูล
    sql =
      "UPDATE `trip` SET `name`=?, `country`=?, `destinationid`=?, `coverimage`=?, `detail`=?, `price`=?, `duration`=? WHERE `idx`=?";
    sql = conn.format(sql, [
      updateTrip.name,
      updateTrip.country,
      updateTrip.destinationid,
      updateTrip.coverimage,
      updateTrip.detail,
      updateTrip.price,
      updateTrip.duration,
      id,
    ]);
    
    const [records] = await conn.query(sql);
    const updateResult = records as any;
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } else {
    res.status(404).json({ message: "Trip not found" });
  }
});


// router.post("/", (req, res) => {
//   let body = req.body; 
//   //res.send("Get in trip.ts body: " + JSON.stringify(body));
// //   res.status(201);
// //   res.json(body);

//   res.status(201).json(body);
// });




//GET /trip   /trip?id=99
// router.get("/", (req, res) => {
//   if (req.query.id) {
//     res.send("Get in trip.ts Query id: " + req.query.id);
//   } else {
//     res.send("Get in trip.ts");
//   }
// });

// router.get('/', (req, res) => {
//     res.send('Get in xxxxxx trip.ts');
// });
// router.get("/:id", (req, res) => {
//   res.send("Get in trip.ts id: " + req.params.id);
// });*/