import { fromDbType, type Service } from "./classify";

export type PostDTO = {
  id: string;
  trackingNumber: string | null;
  type: Service;
  address: string | null;
  day: string;
  scannedAt: string;
  scannedBy: string;
  scannedById: string;
};

type Row = {
  id: string;
  trackingNumber: string | null;
  type: string;
  address: string | null;
  day: string;
  scannedAt: Date;
  scannedById: string;
  scannedBy: { name: string };
};

export const postInclude = { scannedBy: { select: { name: true } } } as const;

export function toDTO(p: Row): PostDTO {
  return {
    id: p.id,
    trackingNumber: p.trackingNumber,
    type: fromDbType(p.type),
    address: p.address,
    day: p.day,
    scannedAt: p.scannedAt.toISOString(),
    scannedBy: p.scannedBy.name,
    scannedById: p.scannedById,
  };
}
