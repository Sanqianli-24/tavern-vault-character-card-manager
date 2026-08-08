CREATE TABLE `character_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`rating` integer DEFAULT 0 NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`bookshelf` text DEFAULT '未分类' NOT NULL,
	`image_key` text,
	`description` text DEFAULT '' NOT NULL,
	`source_path` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL
);
