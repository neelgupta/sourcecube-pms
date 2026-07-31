-- AlterTable
ALTER TABLE "ChatChannelMember" ADD COLUMN     "isFavorite" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;
