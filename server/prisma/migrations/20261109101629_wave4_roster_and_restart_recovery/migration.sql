-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "currentSlideStartedAt" TIMESTAMP(3),
ADD COLUMN     "revealedSlideIds" TEXT NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Anonymous',
    "avatar" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Participant_sessionId_idx" ON "Participant"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_sessionId_participantId_key" ON "Participant"("sessionId", "participantId");

-- CreateIndex
CREATE INDEX "Session_status_startedAt_idx" ON "Session"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
