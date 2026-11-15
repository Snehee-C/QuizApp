-- CreateTable
CREATE TABLE "AudienceArrival" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "slideId" TEXT NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudienceArrival_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AudienceArrival_sessionId_idx" ON "AudienceArrival"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AudienceArrival_sessionId_participantId_slideId_key" ON "AudienceArrival"("sessionId", "participantId", "slideId");

-- AddForeignKey
ALTER TABLE "AudienceArrival" ADD CONSTRAINT "AudienceArrival_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
