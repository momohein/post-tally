import { fromDbType, type Service } from "./classify";

export type PostDTO = {
  id: string;
  trackingNumber: string | null;
  type: Service;
  address: string | null;
  office: string;
  day: string;
  scannedAt: string;
  scannedBy: string;
  scannedById: string;
  listId: string | null;
  listSender: string | null;
};

type Row = {
  id: string;
  trackingNumber: string | null;
  type: string;
  address: string | null;
  office: string;
  day: string;
  scannedAt: Date;
  scannedById: string;
  scannedBy: { name: string };
  listId: string | null;
  list: { sender: string | null } | null;
};

export const postInclude = { scannedBy: { select: { name: true } }, list: { select: { sender: true } } } as const;

export function toDTO(p: Row): PostDTO {
  return {
    id: p.id,
    trackingNumber: p.trackingNumber,
    type: fromDbType(p.type),
    address: p.address,
    office: p.office,
    day: p.day,
    scannedAt: p.scannedAt.toISOString(),
    scannedBy: p.scannedBy.name,
    scannedById: p.scannedById,
    listId: p.listId,
    listSender: p.listId ? (p.list?.sender ?? "") : null,
  };
}
