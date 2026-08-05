CREATE TABLE "SmtpEmailSetting" (
  "tenantId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "host" TEXT,
  "port" INTEGER,
  "security" TEXT NOT NULL DEFAULT 'TLS',
  "username" TEXT,
  "password" TEXT,
  "senderEmail" TEXT,
  "senderName" TEXT,
  "defaultRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lastTestedAt" TIMESTAMP(3),
  "lastTestStatus" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmtpEmailSetting_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "SmtpEmailSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
