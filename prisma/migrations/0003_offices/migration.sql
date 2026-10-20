-- Which post office each record and posting list belongs to ("ringsend" or "ballsbridge").
-- Rows saved before offices existed are put under Ringsend.
ALTER TABLE "Post" ADD COLUMN "office" TEXT NOT NULL DEFAULT 'ringsend';
ALTER TABLE "Post" ALTER COLUMN "office" DROP DEFAULT;
ALTER TABLE "PostingList" ADD COLUMN "office" TEXT NOT NULL DEFAULT 'ringsend';
ALTER TABLE "PostingList" ALTER COLUMN "office" DROP DEFAULT;

-- Replace the day indexes with office + day, which is how the app looks records up.
DROP INDEX "Post_day_idx";
CREATE INDEX "Post_office_day_idx" ON "Post"("office", "day");
DROP INDEX "PostingList_day_idx";
CREATE INDEX "PostingList_office_day_idx" ON "PostingList"("office", "day");
