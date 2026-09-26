CREATE TABLE "song_upvotes" (
	"user_id" uuid NOT NULL,
	"radio_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "song_upvotes_user_id_radio_id_track_id_pk" PRIMARY KEY("user_id","radio_id","track_id")
);
--> statement-breakpoint
ALTER TABLE "song_upvotes" ADD CONSTRAINT "song_upvotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_upvotes" ADD CONSTRAINT "song_upvotes_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_upvotes" ADD CONSTRAINT "song_upvotes_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "song_upvotes_radio_track_idx" ON "song_upvotes" USING btree ("radio_id","track_id");--> statement-breakpoint
CREATE INDEX "song_upvotes_user_time_idx" ON "song_upvotes" USING btree ("user_id","created_at");