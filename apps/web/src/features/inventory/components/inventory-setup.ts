import type { FacingDirection, Project, RoomDetail, Unit, UnitType } from '@bharat-makaan/shared';
import { createUnitSchema, unitRoomFields } from '@bharat-makaan/validation';
import { z } from 'zod';

export const ROOM_TYPES: RoomDetail['type'][] = ['BEDROOM', 'BATHROOM', 'LIVING', 'DINING', 'KITCHEN', 'BALCONY', 'STUDY', 'UTILITY', 'OTHER'];
export const PROJECT_AMENITIES = ['Clubhouse', 'Swimming Pool', 'Gym', 'Children’s Play Area', 'Landscaped Gardens', 'Walking Track', '24/7 Security', 'CCTV', 'Power Backup', 'Water Supply', 'Lift', 'Visitor Parking', 'EV Charging', 'Rainwater Harvesting', 'Sewage Treatment', 'Indoor Games', 'Sports Court', 'Community Hall'];
export const UNIT_AMENITIES = ['Modular Kitchen', 'Air Conditioning', 'Wardrobes', 'Utility Area', 'Private Terrace', 'Private Garden', 'Video Door Phone', 'Piped Gas', 'Smart Home', 'Wheelchair Access'];

export interface RoomDraft { id: string; name: string; type: RoomDetail['type']; length: string; width: string }
export interface UnitDraft {
  number: string; series: string; towerId: string; floor: string; type: UnitType; bhk: string;
  saleable: string; carpet: string; facing: FacingDirection; rate: string; parking: string;
  bedrooms: string; bathrooms: string; balconies: string; furnishing: NonNullable<Unit['furnishing']>;
  rooms: RoomDraft[]; amenities: string[]; corner: boolean; published: boolean;
  listingMode: Unit['listingMode']; monthlyRent: string;
}
export function createUnitDraft(project?: Project): UnitDraft {
  return { number: '', series: '', towerId: '', floor: '1',
    type: project?.projectType === 'PLOTTED' ? 'PLOT' : project?.projectType === 'VILLA' ? 'VILLA' : project?.projectType === 'COMMERCIAL' ? 'OFFICE' : 'APARTMENT',
    bhk: '', saleable: '', carpet: '', facing: 'EAST', rate: '', parking: '0',
    bedrooms: '', bathrooms: '', balconies: '0', furnishing: 'UNFURNISHED', rooms: [], amenities: [],
    corner: false, published: false, listingMode: 'BUY', monthlyRent: '' };
}
export function roomPayload(draft: UnitDraft) {
  return {
    bedroomsCount: draft.bedrooms === '' ? undefined : Number(draft.bedrooms),
    bathroomsCount: draft.bathrooms === '' ? undefined : Number(draft.bathrooms),
    balconiesCount: Number(draft.balconies),
    furnishing: draft.furnishing, unitAmenities: draft.amenities,
    roomDetails: draft.rooms.map((room) => ({
      name: room.name.trim(), type: room.type,
      ...(room.length !== '' ? { lengthFt: Number(room.length) } : {}),
      ...(room.width !== '' ? { widthFt: Number(room.width) } : {}),
    })),
  };
}
export const roomFieldsSchema = z.object(unitRoomFields).extend({
  balconiesCount: z.coerce.number().int().min(0).max(20),
});
export function unitPayload(draft: UnitDraft, orgId: string, projectId: string, requestId?: string) {
  return { orgId, projectId, requestId, unitNumber: draft.number.trim(), series: draft.series.trim() || undefined,
    towerId: draft.towerId || null, floorNumber: ['PLOT', 'VILLA', 'INDEPENDENT_HOUSE'].includes(draft.type) ? 0 : Number(draft.floor),
    unitType: draft.type, bhk: draft.bhk.trim(), saleableAreaSqft: Number(draft.saleable),
    carpetAreaSqft: Number(draft.carpet), facing: draft.facing, baseRatePerSqft: Number(draft.rate),
    parkingEntitlementCount: Number(draft.parking), isCorner: draft.corner, isPublicPublished: draft.published,
    listingMode: draft.listingMode, monthlyRentInr: draft.monthlyRent ? Number(draft.monthlyRent) : undefined,
    ...roomPayload(draft) };
}
export function validateUnitDraft(draft: UnitDraft, orgId: string, projectId: string) {
  return createUnitSchema.safeParse(unitPayload(draft, orgId, projectId));
}
export const PLAN_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export function validatePlanFile(file: Pick<File, 'type' | 'size' | 'name'>, maxMb = 25): string | null {
  if (!PLAN_FILE_TYPES.includes(file.type)) return 'Choose a PDF, JPG, PNG, or WebP file.';
  if (file.size <= 0 || file.size > maxMb * 1024 * 1024) return `Choose a non-empty file smaller than ${maxMb} MB.`;
  if (file.name.length > 180) return 'Use a file name shorter than 180 characters.';
  return null;
}
