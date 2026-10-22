export type TaskStatus = "PROPOSED" | "DELIVERED";

export interface DeliveryTask {
    id:                number;
    task_number:       string;
    //rider_id:          number | null;  //ลบ rider
    //date:              string;
    //departure_time:    string;
    total_distance:    number;
    estimated_minutes: number;
    total_boxes:       number;
    delivery_fee:      number;   // 15 + 2 * distance * boxes
    total_revenue:     number;   // boxes * 65
    total_food_cost:   number;   // boxes * 40
    net_profit:        number;   // revenue - food cost - fee
    route_color:       string;
    status:            TaskStatus;
    created_at:        string;
}
