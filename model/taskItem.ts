export type ItemStatus = "PENDING" | "DELIVERED" | "FAILED";

export interface TaskItem {
    id:              number;
    task_id:         number;
    order_id:        number;
    stop_sequence:   number;
    est_arrival:     string | null;
    actual_arrival:  string | null;
    delivery_status: ItemStatus;
}
