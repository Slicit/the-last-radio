ALTER TABLE "tracks" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "unavailable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "unavailable_reason" text;