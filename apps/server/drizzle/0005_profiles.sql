CREATE TABLE "avatars" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"image" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme" text DEFAULT 'night' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;