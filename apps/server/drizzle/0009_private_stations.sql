CREATE TABLE "email_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radio_domains" (
	"radio_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radio_domains_radio_id_domain_pk" PRIMARY KEY("radio_id","domain")
);
--> statement-breakpoint
CREATE TABLE "radio_members" (
	"radio_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radio_members_radio_id_user_id_pk" PRIMARY KEY("radio_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "radios" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radio_domains" ADD CONSTRAINT "radio_domains_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radio_members" ADD CONSTRAINT "radio_members_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radio_members" ADD CONSTRAINT "radio_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "radio_members_user_idx" ON "radio_members" USING btree ("user_id");