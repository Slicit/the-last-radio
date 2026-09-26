CREATE TABLE "listener_samples" (
	"radio_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"listeners" integer NOT NULL,
	CONSTRAINT "listener_samples_radio_id_at_pk" PRIMARY KEY("radio_id","at")
);
--> statement-breakpoint
ALTER TABLE "listener_samples" ADD CONSTRAINT "listener_samples_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listener_samples_at_idx" ON "listener_samples" USING btree ("at");