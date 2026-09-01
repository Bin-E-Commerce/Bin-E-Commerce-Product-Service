// Producer Kafka dung chung cho integration event cua Product Service.
// Loi broker chi duoc log best-effort, khong rollback review da luu thanh cong trong database.
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Kafka, Producer } from "kafkajs";

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private readonly producer: Producer;

  // Khoi tao producer theo broker tu environment de local va Docker dung chung adapter.
  constructor(private readonly config: ConfigService) {
    const brokers = this.config
      .get<string>("KAFKA_BROKERS", "localhost:29092")
      .split(",")
      .map((broker) => broker.trim())
      .filter(Boolean);
    const kafka = new Kafka({
      clientId: this.config.get<string>("KAFKA_CLIENT_ID", "product-service"),
      brokers,
      retry: { retries: 3 },
    });
    this.producer = kafka.producer();
  }

  // Ket noi non-fatal de Product Service van co the phuc vu review khi Kafka tam thoi chua san sang.
  async onModuleInit(): Promise<void> {
    try {
      await this.producer.connect();
      this.logger.log("Kafka producer connected");
    } catch (error) {
      this.logger.warn(`Kafka producer connect failed (non-fatal): ${String(error)}`);
    }
  }

  // Dong ket noi khi process dung de dev watch khong giu socket cu.
  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect().catch(() => void 0);
  }

  // Publish JSON envelope theo aggregate key review de Notification Service deduplicate theo eventId.
  async publish(topic: string, payload: unknown, aggregateKey: string): Promise<void> {
    try {
      await this.producer.send({
        topic,
        messages: [{ key: aggregateKey, value: JSON.stringify(payload) }],
      });
    } catch (error) {
      this.logger.error(`Failed to publish to topic "${topic}": ${String(error)}`);
    }
  }
}
