import 'dotenv/config';
import { createPool } from 'mysql2/promise';

export const conn = createPool({
    // connectionLimit: 10,
    // host: process.env.DB_HOST as string,
    // port: Number(process.env.DB_PORT),
    // user: process.env.DB_USER as string,
    // password: process.env.DB_PASSWORD as string,
    // database: process.env.DB_NAME as string

    host: process.env.DB_HOST as string,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER as string,
    password: process.env.DB_PASSWORD as string,
    database: process.env.DB_NAME as string
});
