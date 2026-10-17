export type OrderStatus = "PENDING" | "ROUTING" | "ASSIGNED" | "COMPLETED" | "CANCELLED";

export interface Order {
  id: string;
  customer_name: string;
  phone: string;
  latitude: number;
  longitude: number;
  box_quantity: number;
  status: OrderStatus;
  created_at: string;
  distance_from_depot_km?: number;
}
