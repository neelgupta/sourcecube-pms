import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const platformPasswordHash = await bcrypt.hash("Admin@123", 10);

  await prisma.platformUser.upsert({
    where: { email: "meera@sourcecube-saas.com" },
    update: {},
    create: {
      name: "Meera Kapoor",
      email: "meera@sourcecube-saas.com",
      passwordHash: platformPasswordHash,
      role: "saas_super_admin",
    },
  });

  const company = await prisma.company.upsert({
    where: { code: "SCI" },
    update: {},
    create: {
      name: "Sourcecube India",
      code: "SCI",
      domain: "sourcecube.com",
      country: "India",
      timezone: "Asia/Kolkata",
      currency: "INR",
      fiscalYearStart: "04-01",
      status: "active",
      plan: "enterprise",
      employeeSeatLimit: 100,
      enabledModules: ["projects", "resources", "tasks"],
      onboardingCompletedAt: new Date(),
    },
  });

  const companyUserPasswordHash = await bcrypt.hash("Admin@123", 10);

  await prisma.companyUser.upsert({
    where: { tenantId_email: { tenantId: company.id, email: "vinayak@sourcecube.com" } },
    update: {},
    create: {
      tenantId: company.id,
      name: "Vinayak Pawar",
      email: "vinayak@sourcecube.com",
      passwordHash: companyUserPasswordHash,
      roles: ["company_super_admin"],
      accountStatus: "active",
    },
  });

  console.log("Seed complete.");
  console.log("Platform login: meera@sourcecube-saas.com / Admin@123");
  console.log("Company login:  vinayak@sourcecube.com / Admin@123 (tenant: SCI)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
