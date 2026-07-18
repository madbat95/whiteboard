import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.service';
import { BoardsService } from './boards.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { SaveSnapshotDto } from './dto/save-snapshot.dto';
import type {
  CreateBoardResponse,
  DeleteBoardResponse,
  GetBoardResponse,
  ListBoardsResponse,
  SaveBoardSnapshotResponse,
} from '../../../shared/contract';

@Controller('api/boards')
@UseGuards(JwtAuthGuard)
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Post()
  create(@Body() dto: CreateBoardDto, @CurrentUser() user: AuthenticatedUser): Promise<CreateBoardResponse> {
    return this.boardsService.create(user.id, dto.name);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<ListBoardsResponse> {
    return this.boardsService.list(user.id);
  }

  @Get(':roomId')
  get(@Param('roomId') roomId: string): Promise<GetBoardResponse> {
    return this.boardsService.get(roomId);
  }

  @Patch(':roomId')
  saveSnapshot(
    @Param('roomId') roomId: string,
    @Body() dto: SaveSnapshotDto,
  ): Promise<SaveBoardSnapshotResponse> {
    return this.boardsService.saveSnapshot(roomId, dto.objects);
  }

  @Delete(':roomId')
  remove(
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DeleteBoardResponse> {
    return this.boardsService.remove(roomId, user.id);
  }
}
