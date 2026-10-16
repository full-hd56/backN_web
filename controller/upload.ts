import express from "express";
import path from "path";
import multer from "multer";
import { v4 as uuidv4 } from 'uuid';
import fs from "fs";

export const router = express.Router();

class FileMiddleware {
  constructor() {
    const uploadsDir = path.join(__dirname, "../uploads");
    if (!fs.existsSync(uploadsDir)) {
      // สร้างโฟลเดอร์สำหรับอัปโหลดอัตโนมัติหากยังไม่มีอยู่
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
  }

  public readonly diskLoader = multer({
    storage: multer.diskStorage({
      // กำหนดปลายทางเก็บไฟล์
      destination: (_req, _file, cb) => {
        cb(null, path.join(__dirname, "../uploads"));
      },
      // กำหนดชื่อไฟล์ใหม่ให้ไม่ซ้ำโดยใช้ UUID ร่วมกับนามสกุลไฟล์เดิม
      filename: (_req, file, cb) => {
        const uniqueSuffix = uuidv4();      
        const ext = file.originalname.split(".").pop();
        cb(null, `${uniqueSuffix}.${ext}`);
      },
    }),
    limits: {
      fileSize: 67108864, // จำกัดขนาดไฟล์ไม่เกิน 64 MByte
    },
  });
}

const fileUpload = new FileMiddleware();

// เส้นอัปโหลดไฟล์เดี่ยว
router.post("/", fileUpload.diskLoader.single("file"), (req, res) => {
  // ดึงชื่อไฟล์จาก req.file.filename (ระวังอย่าเก็บชื่อไฟล์ไว้ในตัวแปรคลาส เพราะอาจจะเกิด Race Condition สลับชื่อไฟล์หากมีการอัปโหลดพร้อมกันหลายคน!)
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  res.json({ filename: req.file.filename });
});

router.get("/:filename", (req, res) => {
  const filename = req.params.filename;
  const download = req.query.download || undefined;
  
  if (download === "true") {
    // บังคับให้ดาวน์โหลดลงเครื่อง
    res.download(path.join(__dirname, "../uploads", filename));
  } else {
    // แสดงผลไฟล์บนเบราว์เซอร์ปกติ (เช่น แสดงรูปภาพ)
    res.sendFile(path.join(__dirname, "../uploads", filename));
  }
});