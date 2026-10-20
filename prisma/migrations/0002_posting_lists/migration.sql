-- CreateTable
CREATE TABLE "PostingList" (
    "id" TEXT NOT NULL,
    "sender" TEXT,
    "day" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scannedById" TEXT NOT NULL,

    CONSTRAINT "PostingList_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "listId" TEXT;

-- CreateIndex
CREATE INDEX "PostingList_day_idx" ON "PostingList"("day");

-- CreateIndex
CREATE INDEX "Post_listId_idx" ON "Post"("listId");

-- AddForeignKey
ALTER TABLE "PostingList" ADD CONSTRAINT "PostingList_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_listId_fkey" FOREIGN KEY ("listId") REFERENCES "PostingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
