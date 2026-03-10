import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create users
  const tomHash = await bcrypt.hash("admin123", 10);
  const danHash = await bcrypt.hash("pass123", 10);
  const mikeHash = await bcrypt.hash("pass123", 10);

  const tom = await prisma.user.upsert({
    where: { email: "tom@williamsoncivil.com" },
    update: {},
    create: {
      name: "Tom",
      email: "tom@williamsoncivil.com",
      passwordHash: tomHash,
      role: "ADMIN",
      phone: "360-555-0101",
    },
  });

  const dan = await prisma.user.upsert({
    where: { email: "dan@williamsoncivil.com" },
    update: {},
    create: {
      name: "Dan",
      email: "dan@williamsoncivil.com",
      passwordHash: danHash,
      role: "EMPLOYEE",
      phone: "360-555-0102",
    },
  });

  const mike = await prisma.user.upsert({
    where: { email: "mike@mikesplumbing.com" },
    update: {},
    create: {
      name: "Mike - Mike's Plumbing",
      email: "mike@mikesplumbing.com",
      passwordHash: mikeHash,
      role: "SUBCONTRACTOR",
      phone: "360-555-0200",
    },
  });

  console.log("Users created:", { tom: tom.id, dan: dan.id, mike: mike.id });

  // Create Job 1: Riverside Commons
  const riversideCommons = await prisma.job.create({
    data: {
      name: "Riverside Commons",
      address: "123 Riverside Dr, Bellingham WA",
      description: "Multi-unit residential development along the Nooksack River corridor.",
      status: "ACTIVE",
      color: "#3B82F6",
    },
  });

  const [rcSitePrep, rcFoundation, rcFraming, rcRoughPlumbing] = await Promise.all([
    prisma.phase.create({
      data: { name: "Site Prep", description: "Site clearing, grading, and utility rough-in", orderIndex: 0, jobId: riversideCommons.id },
    }),
    prisma.phase.create({
      data: { name: "Foundation", description: "Footings and concrete foundation pour", orderIndex: 1, jobId: riversideCommons.id },
    }),
    prisma.phase.create({
      data: { name: "Framing", description: "Structural framing and sheathing", orderIndex: 2, jobId: riversideCommons.id },
    }),
    prisma.phase.create({
      data: { name: "Rough Plumbing", description: "Underground and in-wall plumbing rough-in", orderIndex: 3, jobId: riversideCommons.id },
    }),
  ]);

  // Create Job 2: Smith Residence
  const smithResidence = await prisma.job.create({
    data: {
      name: "Smith Residence",
      address: "456 Oak St, Ferndale WA",
      description: "Single-family home remodel and addition.",
      status: "ACTIVE",
      color: "#10B981",
    },
  });

  const [srDemolition, srFoundation, srFraming, srFinish] = await Promise.all([
    prisma.phase.create({
      data: { name: "Demolition", description: "Interior and exterior demo", orderIndex: 0, jobId: smithResidence.id },
    }),
    prisma.phase.create({
      data: { name: "Foundation", description: "New addition foundation", orderIndex: 1, jobId: smithResidence.id },
    }),
    prisma.phase.create({
      data: { name: "Framing", description: "Addition framing", orderIndex: 2, jobId: smithResidence.id },
    }),
    prisma.phase.create({
      data: { name: "Finish Work", description: "Drywall, trim, paint, and fixtures", orderIndex: 3, jobId: smithResidence.id },
    }),
  ]);

  console.log("Jobs and phases created");

  // Schedule entries
  const march15 = new Date("2024-03-15T00:00:00.000Z");

  // Tom on Riverside Commons Site Prep on 2024-03-15
  await prisma.scheduleEntry.create({
    data: {
      jobId: riversideCommons.id,
      phaseId: rcSitePrep.id,
      userId: tom.id,
      date: march15,
      startTime: "07:00",
      endTime: "15:00",
      notes: "Oversee site grading operations",
    },
  });

  // Mike on Riverside Commons Rough Plumbing on 2024-03-15
  await prisma.scheduleEntry.create({
    data: {
      jobId: riversideCommons.id,
      phaseId: rcRoughPlumbing.id,
      userId: mike.id,
      date: march15,
      startTime: "07:00",
      endTime: "15:00",
      notes: "Install underground drain lines",
    },
  });

  // Mike also on Smith Residence Foundation on 2024-03-15 (double booking!)
  await prisma.scheduleEntry.create({
    data: {
      jobId: smithResidence.id,
      phaseId: srFoundation.id,
      userId: mike.id,
      date: march15,
      startTime: "10:00",
      endTime: "16:00",
      notes: "Plumbing stub-outs for foundation",
    },
  });

  console.log("Schedule entries created (including double-booking for Mike)");

  // Messages on Riverside Commons
  await prisma.message.create({
    data: {
      content: "Site inspection completed. Grading is on track, ready for underground utilities next week.",
      authorId: tom.id,
      jobId: riversideCommons.id,
    },
  });

  await prisma.message.create({
    data: {
      content: "Materials for rough plumbing have been ordered. Delivery confirmed for March 14th.",
      authorId: mike.id,
      jobId: riversideCommons.id,
      phaseId: rcRoughPlumbing.id,
    },
  });

  console.log("Messages created");

  // Production log
  await prisma.productionLog.create({
    data: {
      date: march15,
      metricName: "Linear ft of pipe installed",
      value: 125,
      unit: "linear ft",
      notes: "Main drain line from building pad to street connection",
      jobId: riversideCommons.id,
      phaseId: rcRoughPlumbing.id,
    },
  });

  console.log("Production log created");
  console.log("✅ Seed complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
