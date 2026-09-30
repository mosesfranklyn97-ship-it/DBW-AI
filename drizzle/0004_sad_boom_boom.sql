CREATE TABLE "project_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_shares_token_idx" ON "project_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "project_shares_project_idx" ON "project_shares" USING btree ("project_id");