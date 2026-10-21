-- Each item belongs to a numbered bag for its service (registered / express / parcel) at its office that day.
ALTER TABLE "Post" ADD COLUMN "bag" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "BagClose" (
    "id" TEXT NOT NULL,
    "office" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "type" "PostType" NOT NULL,
    "number" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT NOT NULL,

    CONSTRAINT "BagClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BagClose_office_day_type_number_key" ON "BagClose"("office", "day", "type", "number");

-- AddForeignKey
ALTER TABLE "BagClose" ADD CONSTRAINT "BagClose_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
