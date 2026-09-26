ALTER TABLE "users" ADD COLUMN "privacy_ack_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "privacy_ack_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;