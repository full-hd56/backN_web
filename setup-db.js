require("dotenv/config");
const mysql = require("mysql2/promise");

const sql = `
CREATE TABLE IF NOT EXISTS customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address_detail TEXT NOT NULL,
    latitude DOUBLE NOT NULL,
    longitude DOUBLE NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS riders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    vehicle_plate VARCHAR(50) DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    box_amount INT NOT NULL,
    total_price DOUBLE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id)
        REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS delivery_tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_number VARCHAR(50) NOT NULL UNIQUE,
    rider_id INT DEFAULT NULL,
    date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    departure_time VARCHAR(10) NOT NULL DEFAULT '11:30',
    total_distance DOUBLE NOT NULL DEFAULT 0.0,
    estimated_minutes INT NOT NULL DEFAULT 0,
    total_boxes INT NOT NULL DEFAULT 0,
    delivery_fee DOUBLE NOT NULL DEFAULT 0.0,
    total_revenue DOUBLE NOT NULL DEFAULT 0.0,
    total_food_cost DOUBLE NOT NULL DEFAULT 0.0,
    net_profit DOUBLE NOT NULL DEFAULT 0.0,
    route_color VARCHAR(20) NOT NULL DEFAULT '#EF4444',
    status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tasks_rider FOREIGN KEY (rider_id)
        REFERENCES riders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id INT NOT NULL,
    order_id INT NOT NULL UNIQUE,
    stop_sequence INT NOT NULL,
    est_arrival VARCHAR(10) DEFAULT NULL,
    actual_arrival DATETIME DEFAULT NULL,
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    CONSTRAINT fk_task_items_task FOREIGN KEY (task_id)
        REFERENCES delivery_tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_items_order FOREIGN KEY (order_id)
        REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });
  console.log("กำลังสร้างตารางใน database:", process.env.DB_NAME);
  await conn.query(sql);
  const [tables] = await conn.query("SHOW TABLES");
  console.log("ตารางที่มีตอนนี้:", tables);
  await conn.end();
})().catch((e) => console.error("ERROR:", e.code, e.message));