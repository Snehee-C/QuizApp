-- AlterTable
ALTER TABLE "Response" ADD COLUMN     "slideConfig" TEXT,
ADD COLUMN     "slideQuestion" TEXT,
ADD COLUMN     "slideType" TEXT;

-- AlterTable
ALTER TABLE "Slide" ADD COLUMN     "deletedAt" TIMESTAMP(3);
