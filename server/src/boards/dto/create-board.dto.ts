import { IsString, MinLength } from 'class-validator';

// Mirrors CreateBoardRequest in /shared/contract.ts
export class CreateBoardDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
