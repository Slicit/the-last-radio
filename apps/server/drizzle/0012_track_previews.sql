ALTER TABLE "tracks" ADD COLUMN "is_preview" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Songs added before this: SoundCloud reports its previews as exactly 30 seconds.
UPDATE "tracks" SET "is_preview" = true WHERE "source_key" LIKE 'Soundcloud:%' AND "duration_sec" = 30;
