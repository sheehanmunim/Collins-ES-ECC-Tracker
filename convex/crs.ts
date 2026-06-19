import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx, mutation, query } from "./_generated/server";

const crStatus = v.union(
  v.literal("Intake"),
  v.literal("Documentation Pending"),
  v.literal("Ready for Review"),
  v.literal("Meeting Scheduled"),
  v.literal("Testing"),
  v.literal("Review"),
  v.literal("Approved"),
  v.literal("Approved w/Actions"),
  v.literal("In Progress"),
  v.literal("Blocked"),
  v.literal("Held for Actions"),
  v.literal("Pending OOC Approvals"),
  v.literal("Implemented"),
  v.literal("Waiver Processing"),
  v.literal("NCDOC/xClass"),
  v.literal("CM Working List"),
  v.literal("Closed"),
  v.literal("Rejected"),
);

const priority = v.union(
  v.literal("Low"),
  v.literal("Medium"),
  v.literal("High"),
  v.literal("Critical"),
);

const risk = v.union(v.literal("Low"), v.literal("Medium"), v.literal("High"));

const eccBoard = v.union(
  v.literal("PWES Commercial"),
  v.literal("PWES Military"),
  v.literal("EC&A"),
  v.literal("P&C"),
  v.literal("Other"),
);

const crClassification = v.union(
  v.literal("TBD"),
  v.literal("Class Concurrence"),
  v.literal("Class I"),
  v.literal("Class II"),
  v.literal("Waiver"),
  v.literal("Admin/NonTech"),
);

const reviewGate = v.union(
  v.literal("None"),
  v.literal("CC"),
  v.literal("CII"),
  v.literal("G1"),
  v.literal("G2"),
  v.literal("G3"),
  v.literal("G4"),
  v.literal("P&C"),
  v.literal("Waiver"),
  v.literal("Delta Review"),
);

const taskState = v.union(
  v.literal("Not Started"),
  v.literal("In Progress"),
  v.literal("Complete"),
  v.literal("Blocked"),
  v.literal("Not Applicable"),
);

const actionStatus = v.union(
  v.literal("Open"),
  v.literal("Closed"),
  v.literal("Not Holding"),
);

const approvalStatus = v.union(
  v.literal("Needed"),
  v.literal("Sent"),
  v.literal("Approved"),
  v.literal("Rejected"),
  v.literal("Not Required"),
);

const approvalSource = v.union(
  v.literal("SharePoint"),
  v.literal("Email"),
  v.literal("Chair"),
  v.literal("Program"),
  v.literal("Other"),
);

const statusFilter = v.union(
  v.literal("All"),
  v.literal("Intake"),
  v.literal("Documentation Pending"),
  v.literal("Ready for Review"),
  v.literal("Meeting Scheduled"),
  v.literal("Testing"),
  v.literal("Review"),
  v.literal("Approved"),
  v.literal("Approved w/Actions"),
  v.literal("In Progress"),
  v.literal("Blocked"),
  v.literal("Held for Actions"),
  v.literal("Pending OOC Approvals"),
  v.literal("Implemented"),
  v.literal("Waiver Processing"),
  v.literal("NCDOC/xClass"),
  v.literal("CM Working List"),
  v.literal("Closed"),
  v.literal("Rejected"),
);

type CrPatch = Partial<{
  crNumber: string;
  title: string;
  status: Doc<"crs">["status"];
  priority: Doc<"crs">["priority"];
  risk: Doc<"crs">["risk"];
  category: string;
  owner: string;
  requester: string;
  system: string;
  targetDate: string | null;
  submittedDate: string;
  description: string;
  businessImpact: string;
  technicalNotes: string;
  tags: string[];
  eccBoard: Doc<"crs">["eccBoard"];
  classification: Doc<"crs">["classification"];
  currentGate: Doc<"crs">["currentGate"];
  meetingDate: string | null;
  meetingTimeEst: string;
  ncdocNumber: string;
  classGateMilitarySupplierEc: string;
  responsibleIpts: string[];
  enginePrograms: string[];
  componentModels: string[];
  supplier: string;
  far15: boolean;
  documentationDeadline: string | null;
  crFolderPath: string;
  wbsChargeNumber: string;
  chargeNumberActive: boolean;
  quorum: string[];
  documentationNotificationStatus: Doc<"crs">["documentationNotificationStatus"];
  preMeetingReviewStatus: Doc<"crs">["preMeetingReviewStatus"];
  meetingAttendanceStatus: Doc<"crs">["meetingAttendanceStatus"];
  postMeetingPdfStatus: Doc<"crs">["postMeetingPdfStatus"];
  ncdocStatus: Doc<"crs">["ncdocStatus"];
  xclassStatus: Doc<"crs">["xclassStatus"];
  oocApprovalStatus: Doc<"crs">["oocApprovalStatus"];
  chairApprovalStatus: Doc<"crs">["chairApprovalStatus"];
  closureNotificationStatus: Doc<"crs">["closureNotificationStatus"];
  cmWorkingListStatus: Doc<"crs">["cmWorkingListStatus"];
  waiverOption: string | null;
  designAuthority: string;
  disposition: string;
  eccCoordinator: string;
  isArchived: boolean;
  lastUpdatedAt: number;
}>;

type AuthIdentity = NonNullable<
  Awaited<ReturnType<QueryCtx["auth"]["getUserIdentity"]>>
>;

async function requireAuthenticated(
  ctx: Pick<QueryCtx | MutationCtx, "auth">,
): Promise<AuthIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }
  return identity;
}

function identityDisplayName(identity: AuthIdentity) {
  return cleanText(
    identity.name ?? identity.email ?? "Collins user",
    "Collins user",
  );
}

function cleanCrNumber(value: string) {
  const normalized = normalizeCrNumber(value);
  if (!/^CR-\d{7}$/.test(normalized)) {
    throw new Error("CR number must use the format CR-0222162.");
  }
  return normalized;
}

function normalizeCrNumber(value: string) {
  const normalized = value.trim().toUpperCase();
  const digitsOnly = normalized.match(/^CR[-\s_]*(\d{1,7})$/);
  if (digitsOnly) {
    return `CR-${digitsOnly[1].padStart(7, "0")}`;
  }
  return normalized;
}

export const list = query({
  args: { status: statusFilter },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx);

    if (args.status !== "All") {
      const status = args.status as Doc<"crs">["status"];
      return await ctx.db
        .query("crs")
        .withIndex("by_isArchived_and_status", (q) =>
          q.eq("isArchived", false).eq("status", status),
        )
        .order("desc")
        .take(200);
    }

    return await ctx.db
      .query("crs")
      .withIndex("by_isArchived", (q) => q.eq("isArchived", false))
      .order("desc")
      .take(200);
  },
});

export const listWhiteboardPositions = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuthenticated(ctx);

    const positions = await ctx.db
      .query("crWhiteboardPositions")
      .withIndex("by_userKey", (q) => q.eq("userKey", identity.tokenIdentifier))
      .take(500);

    return positions.map((position) => ({
      crId: position.crId,
      x: position.x,
      y: position.y,
      updatedAt: position.updatedAt,
    }));
  },
});

export const updateWhiteboardPosition = mutation({
  args: {
    crId: v.id("crs"),
    x: v.number(),
    y: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticated(ctx);
    await requireCr(ctx, args.crId);

    const now = Date.now();
    const x = cleanWhiteboardCoordinate(args.x);
    const y = cleanWhiteboardCoordinate(args.y);
    const existing = await ctx.db
      .query("crWhiteboardPositions")
      .withIndex("by_userKey_and_crId", (q) =>
        q.eq("userKey", identity.tokenIdentifier).eq("crId", args.crId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { x, y, updatedAt: now });
    } else {
      await ctx.db.insert("crWhiteboardPositions", {
        crId: args.crId,
        userKey: identity.tokenIdentifier,
        x,
        y,
        updatedAt: now,
      });
    }

    return { crId: args.crId, x, y };
  },
});

export const listUpdates = query({
  args: { crId: v.id("crs") },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx);

    return await ctx.db
      .query("crUpdates")
      .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", args.crId))
      .order("desc")
      .take(30);
  },
});

export const create = mutation({
  args: {
    crNumber: v.string(),
    title: v.string(),
    status: crStatus,
    priority,
    risk,
    category: v.string(),
    owner: v.string(),
    requester: v.string(),
    system: v.string(),
    targetDate: v.union(v.string(), v.null()),
    submittedDate: v.string(),
    description: v.string(),
    businessImpact: v.string(),
    technicalNotes: v.string(),
    tags: v.array(v.string()),
    eccBoard,
    classification: crClassification,
    currentGate: reviewGate,
    meetingDate: v.union(v.string(), v.null()),
    meetingTimeEst: v.string(),
    ncdocNumber: v.string(),
    classGateMilitarySupplierEc: v.string(),
    responsibleIpts: v.array(v.string()),
    enginePrograms: v.array(v.string()),
    componentModels: v.array(v.string()),
    supplier: v.string(),
    far15: v.boolean(),
    documentationDeadline: v.union(v.string(), v.null()),
    crFolderPath: v.string(),
    wbsChargeNumber: v.string(),
    chargeNumberActive: v.boolean(),
    quorum: v.array(v.string()),
    documentationNotificationStatus: taskState,
    preMeetingReviewStatus: taskState,
    meetingAttendanceStatus: taskState,
    postMeetingPdfStatus: taskState,
    ncdocStatus: taskState,
    xclassStatus: taskState,
    oocApprovalStatus: taskState,
    chairApprovalStatus: taskState,
    closureNotificationStatus: taskState,
    cmWorkingListStatus: taskState,
    waiverOption: v.union(v.string(), v.null()),
    designAuthority: v.string(),
    disposition: v.string(),
    eccCoordinator: v.string(),
    author: v.string(),
  },
  handler: async (ctx, args) => {
    const author = identityDisplayName(await requireAuthenticated(ctx));
    const crNumber = cleanCrNumber(args.crNumber);
    const title = args.title.trim();

    if (!crNumber || !title) {
      throw new Error("CR number and title are required.");
    }

    const existing = await ctx.db
      .query("crs")
      .withIndex("by_crNumber", (q) => q.eq("crNumber", crNumber))
      .unique();

    if (existing) {
      throw new Error(`A CR with number ${crNumber} already exists.`);
    }

    const now = Date.now();
    const crId = await ctx.db.insert("crs", {
      crNumber,
      title,
      status: args.status,
      priority: args.priority,
      risk: args.risk,
      category: cleanText(args.category, "General"),
      owner: cleanText(args.owner, "Unassigned"),
      requester: cleanText(args.requester, "Unknown"),
      system: cleanText(args.system, "General"),
      targetDate: cleanDate(args.targetDate),
      submittedDate: cleanText(args.submittedDate, todayIso()),
      description: cleanText(args.description, "No description provided."),
      businessImpact: cleanText(args.businessImpact, "Not specified."),
      technicalNotes: cleanText(args.technicalNotes, "Not specified."),
      tags: cleanTags(args.tags),
      eccBoard: args.eccBoard,
      classification: args.classification,
      currentGate: args.currentGate,
      meetingDate: cleanDate(args.meetingDate),
      meetingTimeEst: cleanText(args.meetingTimeEst, ""),
      ncdocNumber: cleanText(args.ncdocNumber, ""),
      classGateMilitarySupplierEc: cleanText(
        args.classGateMilitarySupplierEc,
        "",
      ),
      responsibleIpts: cleanList(args.responsibleIpts),
      enginePrograms: cleanList(args.enginePrograms),
      componentModels: cleanList(args.componentModels),
      supplier: cleanText(args.supplier, ""),
      far15: args.far15,
      documentationDeadline: cleanDate(args.documentationDeadline),
      crFolderPath: cleanText(args.crFolderPath, ""),
      wbsChargeNumber: cleanText(args.wbsChargeNumber, ""),
      chargeNumberActive: args.chargeNumberActive,
      quorum: cleanList(args.quorum),
      documentationNotificationStatus: args.documentationNotificationStatus,
      preMeetingReviewStatus: args.preMeetingReviewStatus,
      meetingAttendanceStatus: args.meetingAttendanceStatus,
      postMeetingPdfStatus: args.postMeetingPdfStatus,
      ncdocStatus: args.ncdocStatus,
      xclassStatus: args.xclassStatus,
      oocApprovalStatus: args.oocApprovalStatus,
      chairApprovalStatus: args.chairApprovalStatus,
      closureNotificationStatus: args.closureNotificationStatus,
      cmWorkingListStatus: args.cmWorkingListStatus,
      waiverOption: cleanNullableText(args.waiverOption),
      designAuthority: cleanText(args.designAuthority, ""),
      disposition: cleanText(args.disposition, "Documentation pending"),
      eccCoordinator: cleanText(args.eccCoordinator, ""),
      isArchived: false,
      lastUpdatedAt: now,
    });

    await ctx.db.insert("crUpdates", {
      crId,
      author,
      body: "CR created.",
      kind: "created",
      createdAt: now,
    });

    return crId;
  },
});

export const update = mutation({
  args: {
    id: v.id("crs"),
    crNumber: v.optional(v.string()),
    title: v.optional(v.string()),
    status: v.optional(crStatus),
    priority: v.optional(priority),
    risk: v.optional(risk),
    category: v.optional(v.string()),
    owner: v.optional(v.string()),
    requester: v.optional(v.string()),
    system: v.optional(v.string()),
    targetDate: v.optional(v.union(v.string(), v.null())),
    submittedDate: v.optional(v.string()),
    description: v.optional(v.string()),
    businessImpact: v.optional(v.string()),
    technicalNotes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    eccBoard: v.optional(eccBoard),
    classification: v.optional(crClassification),
    currentGate: v.optional(reviewGate),
    meetingDate: v.optional(v.union(v.string(), v.null())),
    meetingTimeEst: v.optional(v.string()),
    ncdocNumber: v.optional(v.string()),
    classGateMilitarySupplierEc: v.optional(v.string()),
    responsibleIpts: v.optional(v.array(v.string())),
    enginePrograms: v.optional(v.array(v.string())),
    componentModels: v.optional(v.array(v.string())),
    supplier: v.optional(v.string()),
    far15: v.optional(v.boolean()),
    documentationDeadline: v.optional(v.union(v.string(), v.null())),
    crFolderPath: v.optional(v.string()),
    wbsChargeNumber: v.optional(v.string()),
    chargeNumberActive: v.optional(v.boolean()),
    quorum: v.optional(v.array(v.string())),
    documentationNotificationStatus: v.optional(taskState),
    preMeetingReviewStatus: v.optional(taskState),
    meetingAttendanceStatus: v.optional(taskState),
    postMeetingPdfStatus: v.optional(taskState),
    ncdocStatus: v.optional(taskState),
    xclassStatus: v.optional(taskState),
    oocApprovalStatus: v.optional(taskState),
    chairApprovalStatus: v.optional(taskState),
    closureNotificationStatus: v.optional(taskState),
    cmWorkingListStatus: v.optional(taskState),
    waiverOption: v.optional(v.union(v.string(), v.null())),
    designAuthority: v.optional(v.string()),
    disposition: v.optional(v.string()),
    eccCoordinator: v.optional(v.string()),
    author: v.string(),
  },
  handler: async (ctx, args) => {
    const author = identityDisplayName(await requireAuthenticated(ctx));
    const existing = await requireCr(ctx, args.id);
    const now = Date.now();
    const patch: CrPatch = { lastUpdatedAt: now };

    if (args.crNumber !== undefined) {
      const crNumber = cleanCrNumber(args.crNumber);
      if (crNumber !== existing.crNumber) {
        const duplicate = await ctx.db
          .query("crs")
          .withIndex("by_crNumber", (q) => q.eq("crNumber", crNumber))
          .unique();
        if (duplicate) {
          throw new Error(`A CR with number ${crNumber} already exists.`);
        }
      }
      patch.crNumber = crNumber;
    }

    if (args.title !== undefined) {
      patch.title = cleanText(args.title, existing.title);
    }
    if (args.status !== undefined) {
      patch.status = args.status;
    }
    if (args.priority !== undefined) {
      patch.priority = args.priority;
    }
    if (args.risk !== undefined) {
      patch.risk = args.risk;
    }
    if (args.category !== undefined) {
      patch.category = cleanText(args.category, existing.category);
    }
    if (args.owner !== undefined) {
      patch.owner = cleanText(args.owner, "Unassigned");
    }
    if (args.requester !== undefined) {
      patch.requester = cleanText(args.requester, "Unknown");
    }
    if (args.system !== undefined) {
      patch.system = cleanText(args.system, "General");
    }
    if (args.targetDate !== undefined) {
      patch.targetDate = cleanDate(args.targetDate);
    }
    if (args.submittedDate !== undefined) {
      patch.submittedDate = cleanText(
        args.submittedDate,
        existing.submittedDate,
      );
    }
    if (args.description !== undefined) {
      patch.description = cleanText(
        args.description,
        "No description provided.",
      );
    }
    if (args.businessImpact !== undefined) {
      patch.businessImpact = cleanText(args.businessImpact, "Not specified.");
    }
    if (args.technicalNotes !== undefined) {
      patch.technicalNotes = cleanText(args.technicalNotes, "Not specified.");
    }
    if (args.tags !== undefined) {
      patch.tags = cleanTags(args.tags);
    }
    if (args.eccBoard !== undefined) {
      patch.eccBoard = args.eccBoard;
    }
    if (args.classification !== undefined) {
      patch.classification = args.classification;
    }
    if (args.currentGate !== undefined) {
      patch.currentGate = args.currentGate;
    }
    if (args.meetingDate !== undefined) {
      patch.meetingDate = cleanDate(args.meetingDate);
    }
    if (args.meetingTimeEst !== undefined) {
      patch.meetingTimeEst = cleanText(args.meetingTimeEst, "");
    }
    if (args.ncdocNumber !== undefined) {
      patch.ncdocNumber = cleanText(args.ncdocNumber, "");
    }
    if (args.classGateMilitarySupplierEc !== undefined) {
      patch.classGateMilitarySupplierEc = cleanText(
        args.classGateMilitarySupplierEc,
        "",
      );
    }
    if (args.responsibleIpts !== undefined) {
      patch.responsibleIpts = cleanList(args.responsibleIpts);
    }
    if (args.enginePrograms !== undefined) {
      patch.enginePrograms = cleanList(args.enginePrograms);
    }
    if (args.componentModels !== undefined) {
      patch.componentModels = cleanList(args.componentModels);
    }
    if (args.supplier !== undefined) {
      patch.supplier = cleanText(args.supplier, "");
    }
    if (args.far15 !== undefined) {
      patch.far15 = args.far15;
    }
    if (args.documentationDeadline !== undefined) {
      patch.documentationDeadline = cleanDate(args.documentationDeadline);
    }
    if (args.crFolderPath !== undefined) {
      patch.crFolderPath = cleanText(args.crFolderPath, "");
    }
    if (args.wbsChargeNumber !== undefined) {
      patch.wbsChargeNumber = cleanText(args.wbsChargeNumber, "");
    }
    if (args.chargeNumberActive !== undefined) {
      patch.chargeNumberActive = args.chargeNumberActive;
    }
    if (args.quorum !== undefined) {
      patch.quorum = cleanList(args.quorum);
    }
    if (args.documentationNotificationStatus !== undefined) {
      patch.documentationNotificationStatus =
        args.documentationNotificationStatus;
    }
    if (args.preMeetingReviewStatus !== undefined) {
      patch.preMeetingReviewStatus = args.preMeetingReviewStatus;
    }
    if (args.meetingAttendanceStatus !== undefined) {
      patch.meetingAttendanceStatus = args.meetingAttendanceStatus;
    }
    if (args.postMeetingPdfStatus !== undefined) {
      patch.postMeetingPdfStatus = args.postMeetingPdfStatus;
    }
    if (args.ncdocStatus !== undefined) {
      patch.ncdocStatus = args.ncdocStatus;
    }
    if (args.xclassStatus !== undefined) {
      patch.xclassStatus = args.xclassStatus;
    }
    if (args.oocApprovalStatus !== undefined) {
      patch.oocApprovalStatus = args.oocApprovalStatus;
    }
    if (args.chairApprovalStatus !== undefined) {
      patch.chairApprovalStatus = args.chairApprovalStatus;
    }
    if (args.closureNotificationStatus !== undefined) {
      patch.closureNotificationStatus = args.closureNotificationStatus;
    }
    if (args.cmWorkingListStatus !== undefined) {
      patch.cmWorkingListStatus = args.cmWorkingListStatus;
    }
    if (args.waiverOption !== undefined) {
      patch.waiverOption = cleanNullableText(args.waiverOption);
    }
    if (args.designAuthority !== undefined) {
      patch.designAuthority = cleanText(args.designAuthority, "");
    }
    if (args.disposition !== undefined) {
      patch.disposition = cleanText(args.disposition, "");
    }
    if (args.eccCoordinator !== undefined) {
      patch.eccCoordinator = cleanText(args.eccCoordinator, "");
    }

    await ctx.db.patch(args.id, patch);

    if (args.status !== undefined && args.status !== existing.status) {
      await ctx.db.insert("crUpdates", {
        crId: args.id,
        author,
        body: `Status changed from ${existing.status} to ${args.status}.`,
        kind: "status",
        createdAt: now,
      });
    } else {
      await ctx.db.insert("crUpdates", {
        crId: args.id,
        author,
        body: "CR details updated.",
        kind: "edited",
        createdAt: now,
      });
    }

    return args.id;
  },
});

export const upsertFromAssistant = mutation({
  args: {
    crNumber: v.string(),
    sourceText: v.string(),
    title: v.optional(v.string()),
    status: v.optional(crStatus),
    eccScope: v.optional(v.string()),
    previousWork: v.optional(v.string()),
    disposition: v.optional(v.string()),
    oocApprovalStatus: v.optional(taskState),
    closureNotificationStatus: v.optional(taskState),
    cmWorkingListStatus: v.optional(taskState),
    author: v.string(),
  },
  handler: async (ctx, args) => {
    const author = identityDisplayName(await requireAuthenticated(ctx));
    const crNumber = cleanCrNumber(args.crNumber);
    const now = Date.now();
    const eccScope = cleanOptionalText(args.eccScope);
    const previousWork = cleanOptionalText(args.previousWork);
    const sourceText = truncateText(
      cleanText(args.sourceText, "Collins AI workflow update."),
      1000,
    );
    const disposition =
      cleanOptionalText(args.disposition) ??
      buildAssistantDisposition(args.status, eccScope);

    const existing = await ctx.db
      .query("crs")
      .withIndex("by_crNumber", (q) => q.eq("crNumber", crNumber))
      .unique();

    if (existing) {
      const patch: CrPatch = { lastUpdatedAt: now };

      if (args.status !== undefined) {
        patch.status = args.status;
      }
      if (eccScope) {
        patch.category = eccScope;
        patch.system = eccScope;
        patch.classGateMilitarySupplierEc = eccScope;
        patch.eccBoard = inferEccBoard(eccScope);
      }
      if (args.oocApprovalStatus !== undefined) {
        patch.oocApprovalStatus = args.oocApprovalStatus;
      }
      if (args.closureNotificationStatus !== undefined) {
        patch.closureNotificationStatus = args.closureNotificationStatus;
      }
      if (args.cmWorkingListStatus !== undefined) {
        patch.cmWorkingListStatus = args.cmWorkingListStatus;
      } else if (
        args.status === "CM Working List" &&
        (existing.cmWorkingListStatus ?? "Not Started") === "Not Started"
      ) {
        patch.cmWorkingListStatus = "In Progress";
      }
      if (disposition) {
        patch.disposition = disposition;
      }
      patch.technicalNotes = mergeAssistantTechnicalNotes(
        existing.technicalNotes,
        previousWork,
      );
      patch.tags = mergeTags(
        existing.tags,
        assistantWorkflowTags(args.status, eccScope, previousWork),
      );

      await ctx.db.patch(existing._id, patch);
      await ctx.db.insert("crUpdates", {
        crId: existing._id,
        author,
        body: buildAssistantUpdateBody("updated", {
          status: args.status,
          eccScope,
          previousWork,
          sourceText,
        }),
        kind:
          args.status !== undefined && args.status !== existing.status
            ? "status"
            : "edited",
        createdAt: now,
      });

      return {
        crId: existing._id,
        crNumber,
        operation: "updated",
        status: args.status ?? existing.status,
      };
    }

    const title = cleanText(
      args.title ?? "",
      buildAssistantTitle(crNumber, args.status, eccScope),
    );
    const status = args.status ?? "Intake";
    const crId = await ctx.db.insert("crs", {
      crNumber,
      title,
      status,
      priority: "Medium",
      risk: "Low",
      category: cleanText(eccScope ?? "", "PWES Military ECC"),
      owner: "Unassigned",
      requester: "Unknown",
      system: cleanText(eccScope ?? "", "PWES Military ECC"),
      targetDate: null,
      submittedDate: todayIso(),
      description: sourceText,
      businessImpact: "Not specified.",
      technicalNotes: previousWork
        ? `Previous work: ${previousWork}.`
        : "Created from Collins AI paste.",
      tags: cleanTags(assistantWorkflowTags(status, eccScope, previousWork)),
      eccBoard: inferEccBoard(eccScope ?? ""),
      classification: "TBD",
      currentGate: "None",
      meetingDate: null,
      meetingTimeEst: "",
      ncdocNumber: "",
      classGateMilitarySupplierEc: eccScope ?? "",
      responsibleIpts: [],
      enginePrograms: [],
      componentModels: [],
      supplier: "",
      far15: false,
      documentationDeadline: null,
      crFolderPath: "",
      wbsChargeNumber: "",
      chargeNumberActive: false,
      quorum: [],
      documentationNotificationStatus: "Not Started",
      preMeetingReviewStatus: "Not Started",
      meetingAttendanceStatus: "Not Started",
      postMeetingPdfStatus: "Not Started",
      ncdocStatus: "Not Started",
      xclassStatus: "Not Started",
      oocApprovalStatus: args.oocApprovalStatus ?? "Not Started",
      chairApprovalStatus: "Not Started",
      closureNotificationStatus:
        args.closureNotificationStatus ??
        (status === "Closed"
          ? "Complete"
          : status === "NCDOC/xClass"
            ? "In Progress"
            : "Not Started"),
      cmWorkingListStatus:
        args.cmWorkingListStatus ??
        (status === "CM Working List" ? "In Progress" : "Not Started"),
      waiverOption: null,
      designAuthority: "",
      disposition,
      eccCoordinator: "",
      isArchived: false,
      lastUpdatedAt: now,
    });

    await ctx.db.insert("crUpdates", {
      crId,
      author,
      body: buildAssistantUpdateBody("created", {
        status,
        eccScope,
        previousWork,
        sourceText,
      }),
      kind: "created",
      createdAt: now,
    });

    return { crId, crNumber, operation: "created", status };
  },
});

export const addUpdate = mutation({
  args: {
    crId: v.id("crs"),
    author: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const author = identityDisplayName(await requireAuthenticated(ctx));
    await requireCr(ctx, args.crId);
    const body = args.body.trim();
    if (!body) {
      throw new Error("Update note cannot be empty.");
    }
    const now = Date.now();
    await ctx.db.insert("crUpdates", {
      crId: args.crId,
      author,
      body,
      kind: "note",
      createdAt: now,
    });
    await ctx.db.patch(args.crId, { lastUpdatedAt: now });
    return args.crId;
  },
});

export const archive = mutation({
  args: { id: v.id("crs"), author: v.string() },
  handler: async (ctx, args) => {
    const author = identityDisplayName(await requireAuthenticated(ctx));
    await requireCr(ctx, args.id);
    const now = Date.now();
    await ctx.db.patch(args.id, { isArchived: true, lastUpdatedAt: now });
    await ctx.db.insert("crUpdates", {
      crId: args.id,
      author,
      body: "CR archived.",
      kind: "edited",
      createdAt: now,
    });
    return args.id;
  },
});

export const listActions = query({
  args: { crId: v.id("crs") },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx);

    return await ctx.db
      .query("crActions")
      .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", args.crId))
      .order("desc")
      .take(100);
  },
});

export const addAction = mutation({
  args: {
    crId: v.id("crs"),
    gate: reviewGate,
    owner: v.string(),
    body: v.string(),
    dueDate: v.union(v.string(), v.null()),
    evidenceLocation: v.string(),
    author: v.string(),
  },
  handler: async (ctx, args) => {
    const author = identityDisplayName(await requireAuthenticated(ctx));
    await requireCr(ctx, args.crId);
    const body = args.body.trim();
    if (!body) {
      throw new Error("Action text cannot be empty.");
    }
    const now = Date.now();
    await ctx.db.insert("crActions", {
      crId: args.crId,
      gate: args.gate,
      owner: cleanText(args.owner, "IPT"),
      body,
      status: "Open",
      dueDate: cleanDate(args.dueDate),
      evidenceLocation: cleanText(args.evidenceLocation, ""),
      createdAt: now,
      closedAt: null,
    });
    await ctx.db.patch(args.crId, {
      status: "Held for Actions",
      disposition: "Held for actions",
      lastUpdatedAt: now,
    });
    await ctx.db.insert("crUpdates", {
      crId: args.crId,
      author,
      body: `Action opened: ${body}`,
      kind: "edited",
      createdAt: now,
    });
    return args.crId;
  },
});

export const updateActionStatus = mutation({
  args: {
    id: v.id("crActions"),
    status: actionStatus,
    evidenceLocation: v.optional(v.string()),
    author: v.string(),
  },
  handler: async (ctx, args) => {
    const author = identityDisplayName(await requireAuthenticated(ctx));
    const action = await ctx.db.get(args.id);
    if (!action) {
      throw new Error("Action not found.");
    }
    await requireCr(ctx, action.crId);
    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: args.status,
      evidenceLocation:
        args.evidenceLocation === undefined
          ? action.evidenceLocation
          : cleanText(args.evidenceLocation, ""),
      closedAt: args.status === "Closed" ? now : null,
    });
    await ctx.db.patch(action.crId, { lastUpdatedAt: now });
    await ctx.db.insert("crUpdates", {
      crId: action.crId,
      author,
      body: `Action marked ${args.status}: ${action.body}`,
      kind: "edited",
      createdAt: now,
    });
    return action.crId;
  },
});

export const listApprovals = query({
  args: { crId: v.id("crs") },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx);

    return await ctx.db
      .query("crApprovals")
      .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", args.crId))
      .order("desc")
      .take(100);
  },
});

export const addApproval = mutation({
  args: {
    crId: v.id("crs"),
    gate: reviewGate,
    approverName: v.string(),
    role: v.string(),
    source: approvalSource,
    evidenceLocation: v.string(),
    author: v.string(),
  },
  handler: async (ctx, args) => {
    const author = identityDisplayName(await requireAuthenticated(ctx));
    await requireCr(ctx, args.crId);
    const approverName = args.approverName.trim();
    if (!approverName) {
      throw new Error("Approver name is required.");
    }
    const now = Date.now();
    await ctx.db.insert("crApprovals", {
      crId: args.crId,
      gate: args.gate,
      approverName,
      role: cleanText(args.role, "Quorum"),
      status: "Needed",
      source: args.source,
      evidenceLocation: cleanText(args.evidenceLocation, ""),
      sentAt: null,
      approvedAt: null,
      createdAt: now,
    });
    await ctx.db.patch(args.crId, {
      oocApprovalStatus: "In Progress",
      status: "Pending OOC Approvals",
      disposition: "Pending OOC approvals",
      lastUpdatedAt: now,
    });
    await ctx.db.insert("crUpdates", {
      crId: args.crId,
      author,
      body: `Approval needed from ${approverName}.`,
      kind: "edited",
      createdAt: now,
    });
    return args.crId;
  },
});

export const updateApprovalStatus = mutation({
  args: {
    id: v.id("crApprovals"),
    status: approvalStatus,
    evidenceLocation: v.optional(v.string()),
    author: v.string(),
  },
  handler: async (ctx, args) => {
    const author = identityDisplayName(await requireAuthenticated(ctx));
    const approval = await ctx.db.get(args.id);
    if (!approval) {
      throw new Error("Approval not found.");
    }
    await requireCr(ctx, approval.crId);
    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: args.status,
      evidenceLocation:
        args.evidenceLocation === undefined
          ? approval.evidenceLocation
          : cleanText(args.evidenceLocation, ""),
      sentAt:
        args.status === "Sent" && approval.sentAt === null
          ? now
          : approval.sentAt,
      approvedAt: args.status === "Approved" ? now : approval.approvedAt,
    });
    await ctx.db.patch(approval.crId, { lastUpdatedAt: now });
    await ctx.db.insert("crUpdates", {
      crId: approval.crId,
      author,
      body: `${approval.approverName} approval marked ${args.status}.`,
      kind: "edited",
      createdAt: now,
    });
    return approval.crId;
  },
});

export const assistantContext = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx);

    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 120);
    const crs = await ctx.db
      .query("crs")
      .withIndex("by_isArchived", (q) => q.eq("isArchived", false))
      .order("desc")
      .take(limit);

    const rows = [];
    for (const cr of crs) {
      const updates = await ctx.db
        .query("crUpdates")
        .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", cr._id))
        .order("desc")
        .take(3);
      const actions = await ctx.db
        .query("crActions")
        .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", cr._id))
        .order("desc")
        .take(20);
      const approvals = await ctx.db
        .query("crApprovals")
        .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", cr._id))
        .order("desc")
        .take(20);

      rows.push({
        crNumber: cr.crNumber,
        title: cr.title,
        status: cr.status,
        priority: cr.priority,
        risk: cr.risk,
        category: cr.category,
        owner: cr.owner,
        requester: cr.requester,
        system: cr.system,
        targetDate: cr.targetDate,
        submittedDate: cr.submittedDate,
        description: cr.description,
        businessImpact: cr.businessImpact,
        technicalNotes: cr.technicalNotes,
        tags: cr.tags,
        eccBoard: cr.eccBoard ?? "Other",
        classification: cr.classification ?? "TBD",
        currentGate: cr.currentGate ?? "None",
        meetingDate: cr.meetingDate ?? null,
        meetingTimeEst: cr.meetingTimeEst ?? "",
        ncdocNumber: cr.ncdocNumber ?? "",
        classGateMilitarySupplierEc: cr.classGateMilitarySupplierEc ?? "",
        responsibleIpts: cr.responsibleIpts ?? [],
        enginePrograms: cr.enginePrograms ?? [],
        componentModels: cr.componentModels ?? [],
        supplier: cr.supplier ?? "",
        far15: cr.far15 ?? false,
        documentationDeadline: cr.documentationDeadline ?? null,
        crFolderPath: cr.crFolderPath ?? "",
        wbsChargeNumber: cr.wbsChargeNumber ?? "",
        chargeNumberActive: cr.chargeNumberActive ?? false,
        quorum: cr.quorum ?? [],
        documentationNotificationStatus:
          cr.documentationNotificationStatus ?? "Not Started",
        preMeetingReviewStatus: cr.preMeetingReviewStatus ?? "Not Started",
        meetingAttendanceStatus: cr.meetingAttendanceStatus ?? "Not Started",
        postMeetingPdfStatus: cr.postMeetingPdfStatus ?? "Not Started",
        ncdocStatus: cr.ncdocStatus ?? "Not Started",
        xclassStatus: cr.xclassStatus ?? "Not Started",
        oocApprovalStatus: cr.oocApprovalStatus ?? "Not Started",
        chairApprovalStatus: cr.chairApprovalStatus ?? "Not Started",
        closureNotificationStatus:
          cr.closureNotificationStatus ?? "Not Started",
        cmWorkingListStatus: cr.cmWorkingListStatus ?? "Not Started",
        waiverOption: cr.waiverOption ?? null,
        designAuthority: cr.designAuthority ?? "",
        disposition: cr.disposition ?? "",
        eccCoordinator: cr.eccCoordinator ?? "",
        openActions: actions
          .filter((action) => action.status !== "Closed")
          .map((action) => ({
            gate: action.gate,
            owner: action.owner,
            body: action.body,
            status: action.status,
            dueDate: action.dueDate,
            evidenceLocation: action.evidenceLocation,
          })),
        approvals: approvals.map((approval) => ({
          gate: approval.gate,
          approverName: approval.approverName,
          role: approval.role,
          status: approval.status,
          source: approval.source,
          evidenceLocation: approval.evidenceLocation,
          sentAt: approval.sentAt,
          approvedAt: approval.approvedAt,
        })),
        latestUpdates: updates.map((update) => ({
          body: update.body,
          author: update.author,
          kind: update.kind,
          createdAt: update.createdAt,
        })),
      });
    }

    return {
      generatedAt: Date.now(),
      totalInContext: rows.length,
      crs: rows,
    };
  },
});

export const assistantCrDetails = query({
  args: { crNumbers: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx);

    const requestedCrNumbers = Array.from(
      new Set(
        args.crNumbers
          .slice(0, 8)
          .map((crNumber) => normalizeCrNumber(crNumber))
          .filter((crNumber) => /^CR-\d{7}$/.test(crNumber)),
      ),
    );
    const rows = [];
    const missing = [];

    for (const crNumber of requestedCrNumbers) {
      const cr = await ctx.db
        .query("crs")
        .withIndex("by_crNumber", (q) => q.eq("crNumber", crNumber))
        .unique();

      if (!cr || cr.isArchived) {
        missing.push(crNumber);
        continue;
      }

      const updates = await ctx.db
        .query("crUpdates")
        .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", cr._id))
        .order("desc")
        .take(3);
      const actions = await ctx.db
        .query("crActions")
        .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", cr._id))
        .order("desc")
        .take(20);
      const approvals = await ctx.db
        .query("crApprovals")
        .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", cr._id))
        .order("desc")
        .take(20);

      rows.push({
        crNumber: cr.crNumber,
        title: cr.title,
        status: cr.status,
        priority: cr.priority,
        risk: cr.risk,
        category: cr.category,
        owner: cr.owner,
        requester: cr.requester,
        system: cr.system,
        targetDate: cr.targetDate,
        submittedDate: cr.submittedDate,
        description: cr.description,
        businessImpact: cr.businessImpact,
        technicalNotes: cr.technicalNotes,
        tags: cr.tags,
        eccBoard: cr.eccBoard ?? "Other",
        classification: cr.classification ?? "TBD",
        currentGate: cr.currentGate ?? "None",
        meetingDate: cr.meetingDate ?? null,
        meetingTimeEst: cr.meetingTimeEst ?? "",
        ncdocNumber: cr.ncdocNumber ?? "",
        classGateMilitarySupplierEc: cr.classGateMilitarySupplierEc ?? "",
        responsibleIpts: cr.responsibleIpts ?? [],
        enginePrograms: cr.enginePrograms ?? [],
        componentModels: cr.componentModels ?? [],
        supplier: cr.supplier ?? "",
        far15: cr.far15 ?? false,
        documentationDeadline: cr.documentationDeadline ?? null,
        crFolderPath: cr.crFolderPath ?? "",
        wbsChargeNumber: cr.wbsChargeNumber ?? "",
        chargeNumberActive: cr.chargeNumberActive ?? false,
        quorum: cr.quorum ?? [],
        documentationNotificationStatus:
          cr.documentationNotificationStatus ?? "Not Started",
        preMeetingReviewStatus: cr.preMeetingReviewStatus ?? "Not Started",
        meetingAttendanceStatus: cr.meetingAttendanceStatus ?? "Not Started",
        postMeetingPdfStatus: cr.postMeetingPdfStatus ?? "Not Started",
        ncdocStatus: cr.ncdocStatus ?? "Not Started",
        xclassStatus: cr.xclassStatus ?? "Not Started",
        oocApprovalStatus: cr.oocApprovalStatus ?? "Not Started",
        chairApprovalStatus: cr.chairApprovalStatus ?? "Not Started",
        closureNotificationStatus:
          cr.closureNotificationStatus ?? "Not Started",
        cmWorkingListStatus: cr.cmWorkingListStatus ?? "Not Started",
        waiverOption: cr.waiverOption ?? null,
        designAuthority: cr.designAuthority ?? "",
        disposition: cr.disposition ?? "",
        eccCoordinator: cr.eccCoordinator ?? "",
        openActions: actions
          .filter((action) => action.status !== "Closed")
          .map((action) => ({
            gate: action.gate,
            owner: action.owner,
            body: action.body,
            status: action.status,
            dueDate: action.dueDate,
            evidenceLocation: action.evidenceLocation,
          })),
        approvals: approvals.map((approval) => ({
          gate: approval.gate,
          approverName: approval.approverName,
          role: approval.role,
          status: approval.status,
          source: approval.source,
          evidenceLocation: approval.evidenceLocation,
          sentAt: approval.sentAt,
          approvedAt: approval.approvedAt,
        })),
        latestUpdates: updates.map((update) => ({
          body: update.body,
          author: update.author,
          kind: update.kind,
          createdAt: update.createdAt,
        })),
      });
    }

    return {
      generatedAt: Date.now(),
      totalInContext: rows.length,
      missing,
      crs: rows,
    };
  },
});

async function requireCr(ctx: MutationCtx, id: Id<"crs">) {
  const cr = await ctx.db.get(id);
  if (!cr || cr.isArchived) {
    throw new Error("CR not found.");
  }
  return cr;
}

function cleanText(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function cleanDate(value: string | null) {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function cleanNullableText(value: string | null) {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function cleanTags(tags: string[]) {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .slice(0, 12),
    ),
  );
}

function mergeTags(existing: string[], incoming: string[]) {
  return cleanTags([...existing, ...incoming]);
}

function assistantWorkflowTags(
  status: Doc<"crs">["status"] | undefined,
  eccScope: string | null,
  previousWork: string | null,
) {
  return [
    eccScope ?? "",
    status === "Closed" || status === "NCDOC/xClass" ? "Closure Prep" : "",
    status === "CM Working List" ? "CM Working List" : "",
    previousWork?.toLowerCase().includes("ooc") ? "OOC" : "",
    "Collins AI",
  ];
}

function cleanList(items: string[]) {
  return Array.from(
    new Set(
      items
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, 30),
    ),
  );
}

function cleanOptionalText(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function cleanWhiteboardCoordinate(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error("Whiteboard position must be a finite number.");
  }
  return Math.max(0, Math.min(5_000, Math.round(value)));
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function inferEccBoard(scope: string): Doc<"crs">["eccBoard"] {
  if (/\b(?:ms|military|pwes)\b/i.test(scope)) {
    return "PWES Military";
  }
  if (/\bcommercial\b/i.test(scope)) {
    return "PWES Commercial";
  }
  if (/\bec\s*&\s*a\b|\bec&a\b/i.test(scope)) {
    return "EC&A";
  }
  if (/\bp\s*&\s*c\b|\bp&c\b/i.test(scope)) {
    return "P&C";
  }
  return "Other";
}

function buildAssistantTitle(
  crNumber: string,
  status: Doc<"crs">["status"] | undefined,
  eccScope: string | null,
) {
  const scope = eccScope ? `${eccScope} ` : "";
  if (status === "Closed") {
    return `${crNumber} - ${scope}closure`;
  }
  if (status === "NCDOC/xClass") {
    return `${crNumber} - ${scope}NCDOC/xClass`;
  }
  if (status === "CM Working List") {
    return `${crNumber} - ${scope}CM Working List`;
  }
  return `${crNumber} - ${scope}workflow update`;
}

function buildAssistantDisposition(
  status: Doc<"crs">["status"] | undefined,
  eccScope: string | null,
) {
  const scope = eccScope ? ` for ${eccScope}` : "";
  if (status === "Closed") {
    return `Closed${scope}`;
  }
  if (status === "NCDOC/xClass") {
    return `${
      eccScope ? `In ${eccScope} records` : "In records"
    }; NCDOC, xClass, and IPT notification pending`;
  }
  if (status === "Pending OOC Approvals") {
    return `Pending OOC approvals${scope}`;
  }
  if (status === "CM Working List") {
    return `In CM Working List readiness${scope}; waiting for CM queue confirmation`;
  }
  return "Created from Collins AI paste";
}

function mergeAssistantTechnicalNotes(
  existingNotes: string,
  previousWork: string | null,
) {
  if (!previousWork) {
    return existingNotes;
  }

  const note = `Previous work: ${previousWork}.`;
  if (existingNotes.toLowerCase().includes(note.toLowerCase())) {
    return existingNotes;
  }
  if (!existingNotes.trim() || existingNotes === "Not specified.") {
    return note;
  }
  return truncateText(`${existingNotes.trim()}\n${note}`, 2000);
}

function buildAssistantUpdateBody(
  operation: "created" | "updated",
  details: {
    status: Doc<"crs">["status"] | undefined;
    eccScope: string | null;
    previousWork: string | null;
    sourceText: string;
  },
) {
  const parts = [
    operation === "created"
      ? "CR created from Collins AI paste."
      : "Collins AI workflow update.",
  ];

  if (details.status) {
    parts.push(`Status set to ${details.status}.`);
  }
  if (details.eccScope) {
    parts.push(`Scope: ${details.eccScope}.`);
  }
  if (details.previousWork) {
    parts.push(`Previous work: ${details.previousWork}.`);
  }
  parts.push(`Paste: ${details.sourceText}`);

  return truncateText(parts.join(" "), 1200);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
