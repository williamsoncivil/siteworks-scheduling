-- CreateEnum
CREATE TYPE "EmailNotificationLevel" AS ENUM ('NONE', 'MENTIONS', 'ALL');

-- AlterTable: add new column with default ALL
ALTER TABLE "User" ADD COLUMN "emailNotificationLevel" "EmailNotificationLevel" NOT NULL DEFAULT 'ALL';

-- Migrate existing data if old column exists (guard for shadow DB)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='User' AND column_name='emailNotifications') THEN
    UPDATE "User" SET "emailNotificationLevel" = 'NONE' WHERE "emailNotifications" = false;
    ALTER TABLE "User" DROP COLUMN "emailNotifications";
  END IF;
END $$;
