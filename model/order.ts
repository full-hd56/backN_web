export type OrderStatus = "PENDING" | "ASSIGNED" | "DELIVERED" | "CANCELLED";

export interface Order {
    id:          number;
    customer_id: number;
    box_amount:  number;   // 1-3 กล่อง
    total_price: number;   // box_amount * 65
    status:      OrderStatus;
    created_at:  string;
}
