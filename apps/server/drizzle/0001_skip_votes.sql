CREATE TYPE "public"."skip_reason" AS ENUM('admin', 'owner', 'votes', 'interrupted');--> statement-breakpoint
CREATE TABLE "skip_votes" (
	"queue_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skip_votes_queue_item_id_user_id_pk" PRIMARY KEY("queue_item_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "skip_reason" "skip_reason";--> statement-breakpoint
ALTER TABLE "radios" ADD COLUMN "skip_vote_percent" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "skip_votes" ADD CONSTRAINT "skip_votes_queue_item_id_queue_items_id_fk" FOREIGN KEY ("queue_item_id") REFERENCES "public"."queue_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skip_votes" ADD CONSTRAINT "skip_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Before votes existed, a skip was either an admin or a broadcaster restart.
UPDATE "queue_items" SET "skip_reason" = CASE WHEN "error" = 'Interrupted' THEN 'interrupted'::skip_reason ELSE 'admin'::skip_reason END WHERE "status" = 'skipped';
