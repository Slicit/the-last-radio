ALTER TABLE "queue_items" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "is_fill" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "radios" ADD COLUMN "hours_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "radios" ADD COLUMN "hours_days" integer[] DEFAULT '{1,2,3,4,5}' NOT NULL;--> statement-breakpoint
ALTER TABLE "radios" ADD COLUMN "hours_start" text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "radios" ADD COLUMN "hours_end" text DEFAULT '18:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "radios" ADD COLUMN "timezone" text DEFAULT 'Europe/Paris' NOT NULL;--> statement-breakpoint
ALTER TABLE "radios" ADD COLUMN "autofill_below_sec" integer DEFAULT 900 NOT NULL;