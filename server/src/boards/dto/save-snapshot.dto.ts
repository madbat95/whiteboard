import { IsArray } from 'class-validator';
import type { BoardObject } from '../../../../shared/contract';

// Mirrors SaveBoardSnapshotRequest in /shared/contract.ts. Per-variant shape
// validation of the BoardObject union is left to the (already-typed)
// frontend caller; we validate the envelope shape here.
export class SaveSnapshotDto {
  @IsArray()
  objects!: BoardObject[];
}
