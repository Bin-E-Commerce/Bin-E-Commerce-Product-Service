// File này lưu một lượt thích duy nhất của một tài khoản trên một review.
// Entity chỉ chịu trách nhiệm persistence và khóa chống trùng; nghiệp vụ nằm ở review service.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { ProductReview } from "./product-review.entity";

@Entity("product_review_likes")
@Index(["reviewId", "userId"], { unique: true })
@Index(["reviewId"])
export class ProductReviewLike {
  // ID nội bộ của lượt thích, không đưa ra làm dữ liệu hiển thị.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Review được thích; xóa review thì các lượt thích liên quan cũng được xóa.
  @Column({ name: "review_id", type: "uuid" })
  reviewId: string;

  @ManyToOne(() => ProductReview, (review) => review.likes, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "review_id" })
  review: ProductReview;

  // User ID do API Gateway xác thực và inject, không nhận từ body của browser.
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  // Thời điểm customer bấm thích để phục vụ audit và sắp xếp nếu cần.
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
