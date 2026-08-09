ALTER TABLE `character_cards` ADD `personality` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `character_cards` ADD `scenario` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `character_cards` ADD `first_message` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `character_cards` ADD `example_dialogue` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `character_cards` ADD `creator_notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `character_cards` ADD `system_prompt` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `character_cards` ADD `post_history_instructions` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `character_cards` ADD `alternate_greetings` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `character_cards` ADD `creator` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `character_cards` ADD `character_version` text DEFAULT '' NOT NULL;