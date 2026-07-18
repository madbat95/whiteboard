import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  BoardObject,
  CreateBoardResponse,
  DeleteBoardResponse,
  GetBoardResponse,
  ListBoardsResponse,
  SaveBoardSnapshotResponse,
} from '../../../shared/contract';

@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, name: string): Promise<CreateBoardResponse> {
    const board = await this.prisma.board.create({
      data: { name, ownerId, objects: [] },
    });
    return {
      roomId: board.id,
      name: board.name,
      ownerId: board.ownerId,
      createdAt: board.createdAt.toISOString(),
    };
  }

  /**
   * Contract: "boards owned by or shared with the current user". This
   * backend's data model (per /shared/contract.ts, which defines no
   * BoardMember/collaborator/invite type) only tracks a single ownerId
   * per board — there is no persisted sharing/ACL concept. Room access
   * for collaboration happens purely via knowing the room-id join link
   * (contract §1: RoomId comment), which isn't a queryable "membership"
   * list. So this returns boards owned by the current user only; the
   * "or shared with" half of the doc comment cannot be implemented
   * without a schema/contract addition. Flagged in the task report.
   */
  async list(ownerId: string): Promise<ListBoardsResponse> {
    const boards = await this.prisma.board.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      boards: boards.map((b) => ({
        roomId: b.id,
        name: b.name,
        updatedAt: b.updatedAt.toISOString(),
      })),
    };
  }

  async get(roomId: string): Promise<GetBoardResponse> {
    const board = await this.prisma.board.findUnique({ where: { id: roomId } });
    if (!board) throw new NotFoundException(`Board ${roomId} not found`);
    return {
      roomId: board.id,
      name: board.name,
      ownerId: board.ownerId,
      objects: (board.objects as unknown as BoardObject[]) ?? [],
      updatedAt: board.updatedAt.toISOString(),
    };
  }

  async saveSnapshot(roomId: string, objects: BoardObject[]): Promise<SaveBoardSnapshotResponse> {
    const board = await this.prisma.board.findUnique({ where: { id: roomId } });
    if (!board) throw new NotFoundException(`Board ${roomId} not found`);

    const updated = await this.prisma.board.update({
      where: { id: roomId },
      data: {
        objects: objects as unknown as object,
        snapshots: { create: { objects: objects as unknown as object } },
      },
    });

    return { roomId: updated.id, updatedAt: updated.updatedAt.toISOString() };
  }

  async remove(roomId: string, requesterId: string): Promise<DeleteBoardResponse> {
    const board = await this.prisma.board.findUnique({ where: { id: roomId } });
    if (!board) throw new NotFoundException(`Board ${roomId} not found`);
    if (board.ownerId !== requesterId) {
      throw new ForbiddenException('Only the board owner can delete this board');
    }
    await this.prisma.board.delete({ where: { id: roomId } });
    return { roomId, deleted: true };
  }
}
