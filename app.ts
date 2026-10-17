import express from "express";
import { router as index } from "./controller/index";
import { router as customer } from "./controller/customer";
//import { router as upload } from "./controller/upload"
import cors from "cors";

export const app = express();

/*const allowedOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://localhost:4200",
  "https://frontend-eight-mu-10.vercel.app",
];*/

const allowedOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://localhost:4200",
  "https://frontend-eight-mu-10.vercel.app",
  "https://web2-ten-green.vercel.app",   // ← เพิ่มบรรทัดนี้
];

app.use(
  cors({
    origin: function (origin, callback) {
      // เช็กหากว่าไม่มี origin (ยิงผ่าน Postman หรือเบื้องหลัง) หรือโดเมนตรงกับ whitelist
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// แปลงข้อมูลแบบข้อความทั่วไป (Text Body)
app.use(express.text());

// แปลงข้อมูลรูปแบบ JSON (JSON Body)
app.use(express.json());

// ===== Routes =====
app.use("/", index);
app.use("/customer", customer);
//app.use("/upload", upload);
//app.use("/uploads", express.static("uploads"));

// ===== ตัวจัดการ error (ต้องอยู่ท้ายสุดเสมอ) =====
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.code || "ERROR", message: err.message });
});

export default app;