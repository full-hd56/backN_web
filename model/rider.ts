export type RiderStatus = "AVAILABLE" | "ON_DUTY" | "OFFLINE";

export interface Rider {
    id:            number;
    name:          string;
    phone:         string;
    vehicle_plate: string | null;
    status:        RiderStatus;
}
