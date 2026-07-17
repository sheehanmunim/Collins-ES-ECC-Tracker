import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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

const taskStateField = v.union(
  v.literal("documentationNotificationStatus"),
  v.literal("preMeetingReviewStatus"),
  v.literal("meetingAttendanceStatus"),
  v.literal("postMeetingPdfStatus"),
  v.literal("ncdocStatus"),
  v.literal("xclassStatus"),
  v.literal("oocApprovalStatus"),
  v.literal("chairApprovalStatus"),
  v.literal("closureNotificationStatus"),
  v.literal("cmWorkingListStatus"),
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

export default defineSchema({
  crs: defineTable({
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
    isArchived: v.boolean(),
    lastUpdatedAt: v.number(),
  })
    .index("by_crNumber", ["crNumber"])
    .index("by_isArchived", ["isArchived"])
    .index("by_isArchived_and_status", ["isArchived", "status"])
    .index("by_isArchived_and_priority", ["isArchived", "priority"])
    .index("by_isArchived_and_owner", ["isArchived", "owner"])
    .index("by_isArchived_and_eccBoard", ["isArchived", "eccBoard"])
    .index("by_isArchived_and_classification", [
      "isArchived",
      "classification",
    ]),
  crUpdates: defineTable({
    crId: v.id("crs"),
    author: v.string(),
    body: v.string(),
    kind: v.union(
      v.literal("note"),
      v.literal("status"),
      v.literal("created"),
      v.literal("edited"),
    ),
    createdAt: v.number(),
  }).index("by_crId_and_createdAt", ["crId", "createdAt"]),
  crActions: defineTable({
    crId: v.id("crs"),
    gate: reviewGate,
    owner: v.string(),
    body: v.string(),
    status: actionStatus,
    dueDate: v.union(v.string(), v.null()),
    evidenceLocation: v.string(),
    createdAt: v.number(),
    closedAt: v.union(v.number(), v.null()),
  })
    .index("by_crId_and_createdAt", ["crId", "createdAt"])
    .index("by_crId_and_status", ["crId", "status"]),
  crApprovals: defineTable({
    crId: v.id("crs"),
    gate: reviewGate,
    approverName: v.string(),
    role: v.string(),
    status: approvalStatus,
    source: approvalSource,
    evidenceLocation: v.string(),
    sentAt: v.union(v.number(), v.null()),
    approvedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
  })
    .index("by_crId_and_createdAt", ["crId", "createdAt"])
    .index("by_crId_and_status", ["crId", "status"]),
  crWhiteboardPositions: defineTable({
    crId: v.id("crs"),
    userKey: v.string(),
    x: v.number(),
    y: v.number(),
    updatedAt: v.number(),
  })
    .index("by_crId", ["crId"])
    .index("by_userKey", ["userKey"])
    .index("by_userKey_and_crId", ["userKey", "crId"]),
  crWorkflowRequirementChecks: defineTable({
    crId: v.id("crs"),
    taskField: taskStateField,
    requirementKey: v.string(),
    label: v.string(),
    complete: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_crId", ["crId"])
    .index("by_crId_and_taskField", ["crId", "taskField"])
    .index("by_crId_and_taskField_and_requirementKey", [
      "crId",
      "taskField",
      "requirementKey",
    ]),
  assistantChatSessions: defineTable({
    ownerKey: v.string(),
    chatId: v.string(),
    title: v.string(),
    messages: v.array(
      v.object({
        role: v.union(v.literal("assistant"), v.literal("user")),
        content: v.string(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    isDeleted: v.boolean(),
  })
    .index("by_ownerKey_and_chatId", ["ownerKey", "chatId"])
    .index("by_ownerKey_and_updatedAt", ["ownerKey", "updatedAt"])
    .index("by_ownerKey_and_isDeleted_and_updatedAt", [
      "ownerKey",
      "isDeleted",
      "updatedAt",
    ]),
  syncOutbox: defineTable({
    eventId: v.string(),
    entityType: v.union(v.literal("cr"), v.literal("assistantChat")),
    entityKey: v.string(),
    updatedAt: v.number(),
    payload: v.string(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_updatedAt", ["updatedAt"]),
  syncAppliedEvents: defineTable({
    eventId: v.string(),
    appliedAt: v.number(),
  }).index("by_eventId", ["eventId"]),
  syncSettings: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),
});
