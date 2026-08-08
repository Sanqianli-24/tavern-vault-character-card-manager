import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const characterCards = sqliteTable("character_cards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  size: integer("size").notNull().default(0),
  rating: integer("rating").notNull().default(0),
  tags: text("tags").notNull().default("[]"),
  bookshelf: text("bookshelf").notNull().default("未分类"),
  imageKey: text("image_key"),
  description: text("description").notNull().default(""),
  sourcePath: text("source_path").notNull().default(""),
  createdAt: text("created_at").notNull(),
  modifiedAt: text("modified_at").notNull(),
});
