import { IsUUID } from "class-validator";

//  Payload rollback output AI ve snapshot anh goc cua job.
export class RollbackAiMediaDto {
  //  Job da apply can khoi phuc.
  @IsUUID()
  jobId: string;
}

