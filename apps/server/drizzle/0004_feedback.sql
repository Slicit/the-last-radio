CREATE TYPE "public"."feedback_kind" AS ENUM('idea', 'bug', 'other');--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "feedback_kind" DEFAULT 'idea' NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_votes" (
	"feedback_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "feedback_votes_feedback_id_user_id_pk" PRIMARY KEY("feedback_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_votes" ADD CONSTRAINT "feedback_votes_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_votes" ADD CONSTRAINT "feedback_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_user_idx" ON "feedback" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_inbox_idx" ON "feedback" USING btree ("archived_at","created_at");