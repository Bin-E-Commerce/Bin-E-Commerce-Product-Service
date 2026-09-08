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
  private connected = false;
  private connecting?: Promise<void>;

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
    await this.ensureConnected();
  }

  // Kết nối lazy để outbox tự phục hồi sau khi broker khởi động muộn hoặc bị restart.
  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.producer.connect()
      .then(() => {
        this.connected = true;
        this.logger.log("Kafka producer connected");
      })
      .catch((error) => {
        this.connected = false;
        this.logger.warn(`Kafka producer connect failed (non-fatal): ${String(error)}`);
        throw error;
      })
      .finally(() => {
        this.connecting = undefined;
      });
    try {
      await this.connecting;
    } catch (error) {
      // Startup không được làm Product Service crash; outbox sẽ retry ở dispatcher.
    }
  }

  // Dong ket noi khi process dung de dev watch khong giu socket cu.
  async onModuleDestroy(): Promise<void> {
    if (this.connected) await this.producer.disconnect().catch(() => void 0);
    this.connected = false;
  }

  // Publish JSON envelope theo aggregate key review de Notification Service deduplicate theo eventId.
  async publish(topic: string, payload: unknown, aggregateKey: string): Promise<boolean> {
    try {
      await this.ensureConnected();
      if (!this.connected) return false;
      await this.producer.send({
        topic,
        messages: [{ key: aggregateKey, value: JSON.stringify(payload) }],
      });
      return true;
    } catch (error) {
      this.connected = false;
      this.logger.error(`Failed to publish to topic "${topic}": ${String(error)}`);
      return false;
    }
  }
}
