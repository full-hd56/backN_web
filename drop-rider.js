require("dotenv/config");
const mysql = require("mysql2/promise");

const steps = [
  "ALTER TABLE delivery_tasks DROP FOREIGN KEY fk_tasks_rider",
  "ALTER TABLE delivery_tasks DROP INDEX idx_tasks_rider_id",
  "ALTER TABLE delivery_tasks DROP COLUMN rider_id",
  "DROP TABLE riders",
];

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  console.log("database:", process.env.DB_NAME);
  for (const sql of steps) {
    try {
      await conn.query(sql);
      console.log("OK   ", sql);
    } catch (e) {
      console.log("SKIP ", sql, "→", e.message);
    }
  }
  const [tables] = await conn.query("SHOW TABLES");
  console.log("ตารางที่เหลือ:", tables);
  await conn.end();
})();