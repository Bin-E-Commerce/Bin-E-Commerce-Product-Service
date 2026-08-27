/** Response nho de AI Service cap nhat job sau transaction Product Service. */
export type AiMediaMutationResponse = {
  productId: string;
  jobId: string;
  status: "APPLIED" | "ROLLED_BACK";
  updatedAt: Date;
};

