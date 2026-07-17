import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server";

type CrData = Omit<Doc<"crs">, "_id" | "_creationTime">;
type CrUpdateData = Omit<Doc<"crUpdates">, "_id" | "_creationTime" | "crId">;
type CrActionData = Omit<Doc<"crActions">, "_id" | "_creationTime" | "crId">;
type CrApprovalData = Omit<
  Doc<"crApprovals">,
  "_id" | "_creationTime" | "crId"
>;
type CrPositionData = Omit<
  Doc<"crWhiteboardPositions">,
  "_id" | "_creationTime" | "crId"
>;
type CrRequirementData = Omit<
  Doc<"crWorkflowRequirementChecks">,
  "_id" | "_creationTime" | "crId"
>;
type AssistantChatData = Omit<
  Doc<"assistantChatSessions">,
  "_id" | "_creationTime"
>;

type CrSnapshot = {
  kind: "cr";
  deleted: false;
  cr: CrData;
  updates: CrUpdateData[];
  actions: CrActionData[];
  approvals: CrApprovalData[];
  positions: CrPositionData[];
  requirements: CrRequirementData[];
};

type CrTombstone = {
  kind: "cr";
  deleted: true;
  crNumber: string;
};

type AssistantChatSnapshot = {
  kind: "assistantChat";
  chat: AssistantChatData;
};

type SyncPayload = CrSnapshot | CrTombstone | AssistantChatSnapshot;

const syncEventValidator = v.object({
  eventId: v.string(),
  entityType: v.union(v.literal("cr"), v.literal("assistantChat")),
  entityKey: v.string(),
  updatedAt: v.number(),
  payload: v.string(),
  protocolVersion: v.optional(v.number()),
  baseEventId: v.optional(v.string()),
  logicalTime: v.optional(v.number()),
  resolvesEventIds: v.optional(v.array(v.string())),
  conflictResolution: v.optional(
    v.union(v.literal("keptCurrent"), v.literal("restoredConflict")),
  ),
});

export const configure = mutation({
  args: { secret: v.string(), hubId: v.string() },
  handler: async (ctx, args) => {
    await setSetting(ctx, "secret", args.secret);
    await setSetting(ctx, "hubId", args.hubId);
    return null;
  },
});

export const listConflicts = query({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticatedUser(ctx);
    const conflicts = await ctx.db
      .query("syncConflicts")
      .withIndex("by_status_and_detectedAt", (q) => q.eq("status", "open"))
      .order("desc")
      .take(100);
    return conflicts.map(({ losingPayload, ...conflict }) => {
      void losingPayload;
      return conflict;
    });
  },
});

export const resolveConflict = mutation({
  args: {
    conflictId: v.id("syncConflicts"),
    resolution: v.union(
      v.literal("keptCurrent"),
      v.literal("restoredConflict"),
    ),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedUser(ctx);
    const conflict = await ctx.db.get(args.conflictId);
    if (!conflict || conflict.status === "resolved") return null;

    const now = Date.now();
    if (args.resolution === "restoredConflict") {
      const payload = parsePayload(conflict.losingPayload);
      if (payload.kind === "cr") {
        await applyCrPayload(ctx, payload, now, true);
      } else {
        await applyAssistantChatPayload(ctx, payload, now, true);
      }
    }

    await queueCurrentEntityVersion(ctx, {
      entityType: conflict.entityType,
      entityKey: conflict.entityKey,
      updatedAt: now,
      resolvesEventIds: [conflict.losingEventId],
      conflictResolution: args.resolution,
    });
    await markConflictResolution(
      ctx,
      conflict.losingEventId,
      args.resolution,
      now,
    );
    return null;
  },
});

export const drainOutbox = query({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    await requireSyncSecret(ctx, args.secret);
    return await ctx.db
      .query("syncOutbox")
      .withIndex("by_updatedAt")
      .order("asc")
      .take(50);
  },
});

export const acknowledgeOutbox = mutation({
  args: { secret: v.string(), eventIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireSyncSecret(ctx, args.secret);
    for (const eventId of args.eventIds.slice(0, 100)) {
      const row = await ctx.db
        .query("syncOutbox")
        .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
        .unique();
      if (row) await ctx.db.delete(row._id);
    }
    return null;
  },
});

export const applyEvents = mutation({
  args: { secret: v.string(), events: v.array(syncEventValidator) },
  handler: async (ctx, args) => {
    await requireSyncSecret(ctx, args.secret);
    const applied: string[] = [];
    for (const event of args.events.slice(0, 20)) {
      const existingEvent = await ctx.db
        .query("syncAppliedEvents")
        .withIndex("by_eventId", (q) => q.eq("eventId", event.eventId))
        .unique();
      if (existingEvent) {
        applied.push(event.eventId);
        continue;
      }

      const payload = parsePayload(event.payload);
      const head = await getEntityHead(ctx, event.entityType, event.entityKey);
      const isProtocol2 =
        event.protocolVersion === 2 && typeof event.logicalTime === "number";

      if (head?.eventId === event.eventId) {
        // This replica may encounter its own published event after rebuilding
        // its filesystem cursor. The local mutation already applied it.
      } else if (!isProtocol2) {
        const incomingIsNewer = !head || event.updatedAt >= head.updatedAt;
        if (incomingIsNewer) {
          await applySyncPayload(ctx, payload, event.updatedAt, false);
          await setEntityHead(ctx, {
            entityType: event.entityType,
            entityKey: event.entityKey,
            eventId: event.eventId,
            logicalTime: (head?.logicalTime ?? 0) + 1,
            updatedAt: event.updatedAt,
          });
        }
      } else {
        const logicalTime = event.logicalTime ?? 1;
        const isLinear = !head || event.baseEventId === head.eventId;
        if (isLinear) {
          await applySyncPayload(ctx, payload, event.updatedAt, true);
          await setEntityHead(ctx, {
            entityType: event.entityType,
            entityKey: event.entityKey,
            eventId: event.eventId,
            logicalTime,
            updatedAt: event.updatedAt,
          });
        } else {
          const incomingWins =
            compareEventRank(
              logicalTime,
              event.eventId,
              head.logicalTime,
              head.eventId,
            ) > 0;
          if (incomingWins) {
            const currentPayload = await snapshotEntityPayload(
              ctx,
              event.entityType,
              event.entityKey,
            );
            if (currentPayload) {
              await preserveConflict(ctx, {
                entityType: event.entityType,
                entityKey: event.entityKey,
                winningEventId: event.eventId,
                losingEventId: head.eventId,
                losingPayload: currentPayload,
              });
            }
            await applySyncPayload(ctx, payload, event.updatedAt, true);
            await setEntityHead(ctx, {
              entityType: event.entityType,
              entityKey: event.entityKey,
              eventId: event.eventId,
              logicalTime,
              updatedAt: event.updatedAt,
            });
          } else {
            await preserveConflict(ctx, {
              entityType: event.entityType,
              entityKey: event.entityKey,
              winningEventId: head.eventId,
              losingEventId: event.eventId,
              losingPayload: event.payload,
            });
          }
        }
      }
      for (const resolvedEventId of event.resolvesEventIds ?? []) {
        await markConflictResolution(
          ctx,
          resolvedEventId,
          event.conflictResolution ?? "keptCurrent",
          event.updatedAt,
        );
      }
      await ctx.db.insert("syncAppliedEvents", {
        eventId: event.eventId,
        appliedAt: Date.now(),
      });
      applied.push(event.eventId);
    }
    return applied;
  },
});

export const seedOutbox = mutation({
  args: { secret: v.string(), hubId: v.string() },
  handler: async (ctx, args) => {
    await requireSyncSecret(ctx, args.secret);
    const seedKey = `seeded:${args.hubId}`;
    const seeded = await getSetting(ctx, seedKey);
    if (seeded) return { crs: 0, chats: 0, alreadySeeded: true };

    const activeCrs = await ctx.db
      .query("crs")
      .withIndex("by_isArchived", (q) => q.eq("isArchived", false))
      .take(200);
    const archivedCrs = await ctx.db
      .query("crs")
      .withIndex("by_isArchived", (q) => q.eq("isArchived", true))
      .take(Math.max(0, 200 - activeCrs.length));
    const crs = [...activeCrs, ...archivedCrs];
    for (const cr of crs) await queueCrSnapshot(ctx, cr._id, cr.lastUpdatedAt);

    const chats = await ctx.db.query("assistantChatSessions").take(100);
    for (const chat of chats) await queueAssistantChatSnapshot(ctx, chat);

    await setSetting(ctx, seedKey, String(Date.now()));
    return { crs: crs.length, chats: chats.length, alreadySeeded: false };
  },
});

export async function queueCrSnapshot(
  ctx: MutationCtx,
  crId: Id<"crs">,
  updatedAt = Date.now(),
  options: QueueOptions = {},
) {
  const cr = await ctx.db.get(crId);
  if (!cr) return;
  const [updates, actions, approvals, positions, requirements] =
    await Promise.all([
      ctx.db
        .query("crUpdates")
        .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", crId))
        .take(500),
      ctx.db
        .query("crActions")
        .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", crId))
        .take(500),
      ctx.db
        .query("crApprovals")
        .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", crId))
        .take(500),
      ctx.db
        .query("crWhiteboardPositions")
        .withIndex("by_crId", (q) => q.eq("crId", crId))
        .take(500),
      ctx.db
        .query("crWorkflowRequirementChecks")
        .withIndex("by_crId", (q) => q.eq("crId", crId))
        .take(500),
    ]);

  const payload: CrSnapshot = {
    kind: "cr",
    deleted: false,
    cr: stripSystem(cr),
    updates: updates.map((row) => stripChild(row)),
    actions: actions.map((row) => stripChild(row)),
    approvals: approvals.map((row) => stripChild(row)),
    positions: positions.map((row) => stripChild(row)),
    requirements: requirements.map((row) => stripChild(row)),
  };
  await enqueue(ctx, "cr", cr.crNumber, updatedAt, payload, options);
}

export async function queueCrDeletion(
  ctx: MutationCtx,
  crNumber: string,
  updatedAt = Date.now(),
  options: QueueOptions = {},
) {
  const payload: CrTombstone = { kind: "cr", deleted: true, crNumber };
  await enqueue(ctx, "cr", crNumber, updatedAt, payload, options);
}

export async function queueAssistantChatSnapshot(
  ctx: MutationCtx,
  chat: Doc<"assistantChatSessions">,
  options: QueueOptions = {},
) {
  const payload: AssistantChatSnapshot = {
    kind: "assistantChat",
    chat: stripSystem(chat),
  };
  await enqueue(
    ctx,
    "assistantChat",
    `${chat.ownerKey}:${chat.chatId}`,
    chat.updatedAt,
    payload,
    options,
  );
}

type ConflictResolution = "keptCurrent" | "restoredConflict";
type QueueOptions = {
  resolvesEventIds?: string[];
  conflictResolution?: ConflictResolution;
};

async function enqueue(
  ctx: MutationCtx,
  entityType: "cr" | "assistantChat",
  entityKey: string,
  updatedAt: number,
  payload: SyncPayload,
  options: QueueOptions = {},
) {
  const head = await getEntityHead(ctx, entityType, entityKey);
  const eventId = crypto.randomUUID();
  const logicalTime = (head?.logicalTime ?? 0) + 1;
  await ctx.db.insert("syncOutbox", {
    eventId,
    entityType,
    entityKey,
    updatedAt,
    payload: JSON.stringify(payload),
    protocolVersion: 2,
    baseEventId: head?.eventId,
    logicalTime,
    resolvesEventIds: options.resolvesEventIds,
    conflictResolution: options.conflictResolution,
  });
  await setEntityHead(ctx, {
    entityType,
    entityKey,
    eventId,
    logicalTime,
    updatedAt,
  });
}

async function applyCrPayload(
  ctx: MutationCtx,
  payload: CrSnapshot | CrTombstone,
  updatedAt: number,
  force = false,
) {
  const crNumber = payload.deleted ? payload.crNumber : payload.cr.crNumber;
  const existing = await ctx.db
    .query("crs")
    .withIndex("by_crNumber", (q) => q.eq("crNumber", crNumber))
    .unique();
  if (!force && existing && existing.lastUpdatedAt > updatedAt) return;

  if (payload.deleted) {
    if (existing) await deleteCrAggregate(ctx, existing._id);
    return;
  }

  let crId: Id<"crs">;
  const crData = { ...payload.cr, lastUpdatedAt: updatedAt };
  if (existing) {
    await deleteCrChildren(ctx, existing._id);
    await ctx.db.replace(existing._id, crData);
    crId = existing._id;
  } else {
    crId = await ctx.db.insert("crs", crData);
  }

  for (const row of payload.updates)
    await ctx.db.insert("crUpdates", { crId, ...row });
  for (const row of payload.actions)
    await ctx.db.insert("crActions", { crId, ...row });
  for (const row of payload.approvals)
    await ctx.db.insert("crApprovals", { crId, ...row });
  for (const row of payload.positions)
    await ctx.db.insert("crWhiteboardPositions", { crId, ...row });
  for (const row of payload.requirements)
    await ctx.db.insert("crWorkflowRequirementChecks", { crId, ...row });
}

async function applyAssistantChatPayload(
  ctx: MutationCtx,
  payload: AssistantChatSnapshot,
  updatedAt: number,
  force = false,
) {
  const chat = payload.chat;
  const existing = await ctx.db
    .query("assistantChatSessions")
    .withIndex("by_ownerKey_and_chatId", (q) =>
      q.eq("ownerKey", chat.ownerKey).eq("chatId", chat.chatId),
    )
    .unique();
  if (!force && existing && existing.updatedAt > updatedAt) return;
  const next = { ...chat, updatedAt };
  if (existing) await ctx.db.replace(existing._id, next);
  else await ctx.db.insert("assistantChatSessions", next);
}

async function applySyncPayload(
  ctx: MutationCtx,
  payload: SyncPayload,
  updatedAt: number,
  force: boolean,
) {
  if (payload.kind === "cr") {
    await applyCrPayload(ctx, payload, updatedAt, force);
  } else {
    await applyAssistantChatPayload(ctx, payload, updatedAt, force);
  }
}

async function queueCurrentEntityVersion(
  ctx: MutationCtx,
  args: {
    entityType: "cr" | "assistantChat";
    entityKey: string;
    updatedAt: number;
    resolvesEventIds: string[];
    conflictResolution: ConflictResolution;
  },
) {
  const options: QueueOptions = {
    resolvesEventIds: args.resolvesEventIds,
    conflictResolution: args.conflictResolution,
  };
  if (args.entityType === "cr") {
    const cr = await ctx.db
      .query("crs")
      .withIndex("by_crNumber", (q) => q.eq("crNumber", args.entityKey))
      .unique();
    if (!cr) {
      await queueCrDeletion(ctx, args.entityKey, args.updatedAt, options);
      return;
    }
    await ctx.db.patch(cr._id, { lastUpdatedAt: args.updatedAt });
    await queueCrSnapshot(ctx, cr._id, args.updatedAt, options);
    return;
  }

  const separator = args.entityKey.lastIndexOf(":");
  if (separator < 1) throw new Error("Invalid assistant chat sync key.");
  const ownerKey = args.entityKey.slice(0, separator);
  const chatId = args.entityKey.slice(separator + 1);
  const chat = await ctx.db
    .query("assistantChatSessions")
    .withIndex("by_ownerKey_and_chatId", (q) =>
      q.eq("ownerKey", ownerKey).eq("chatId", chatId),
    )
    .unique();
  if (!chat) return;
  await ctx.db.patch(chat._id, { updatedAt: args.updatedAt });
  const updated = await ctx.db.get(chat._id);
  if (updated) await queueAssistantChatSnapshot(ctx, updated, options);
}

async function snapshotEntityPayload(
  ctx: MutationCtx,
  entityType: "cr" | "assistantChat",
  entityKey: string,
) {
  if (entityType === "cr") {
    const cr = await ctx.db
      .query("crs")
      .withIndex("by_crNumber", (q) => q.eq("crNumber", entityKey))
      .unique();
    if (!cr) {
      const tombstone: CrTombstone = {
        kind: "cr",
        deleted: true,
        crNumber: entityKey,
      };
      return JSON.stringify(tombstone);
    }
    const [updates, actions, approvals, positions, requirements] =
      await Promise.all([
        ctx.db
          .query("crUpdates")
          .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", cr._id))
          .take(500),
        ctx.db
          .query("crActions")
          .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", cr._id))
          .take(500),
        ctx.db
          .query("crApprovals")
          .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", cr._id))
          .take(500),
        ctx.db
          .query("crWhiteboardPositions")
          .withIndex("by_crId", (q) => q.eq("crId", cr._id))
          .take(500),
        ctx.db
          .query("crWorkflowRequirementChecks")
          .withIndex("by_crId", (q) => q.eq("crId", cr._id))
          .take(500),
      ]);
    const snapshot: CrSnapshot = {
      kind: "cr",
      deleted: false,
      cr: stripSystem(cr),
      updates: updates.map((row) => stripChild(row)),
      actions: actions.map((row) => stripChild(row)),
      approvals: approvals.map((row) => stripChild(row)),
      positions: positions.map((row) => stripChild(row)),
      requirements: requirements.map((row) => stripChild(row)),
    };
    return JSON.stringify(snapshot);
  }

  const separator = entityKey.lastIndexOf(":");
  if (separator < 1) return null;
  const ownerKey = entityKey.slice(0, separator);
  const chatId = entityKey.slice(separator + 1);
  const chat = await ctx.db
    .query("assistantChatSessions")
    .withIndex("by_ownerKey_and_chatId", (q) =>
      q.eq("ownerKey", ownerKey).eq("chatId", chatId),
    )
    .unique();
  if (!chat) return null;
  const snapshot: AssistantChatSnapshot = {
    kind: "assistantChat",
    chat: stripSystem(chat),
  };
  return JSON.stringify(snapshot);
}

async function preserveConflict(
  ctx: MutationCtx,
  args: {
    entityType: "cr" | "assistantChat";
    entityKey: string;
    winningEventId: string;
    losingEventId: string;
    losingPayload: string;
  },
) {
  const existing = await ctx.db
    .query("syncConflicts")
    .withIndex("by_losingEventId", (q) =>
      q.eq("losingEventId", args.losingEventId),
    )
    .unique();
  if (existing) return;
  const savedResolution = await getSetting(
    ctx,
    `resolvedConflict:${args.losingEventId}`,
  );
  const resolution =
    savedResolution === "keptCurrent" || savedResolution === "restoredConflict"
      ? savedResolution
      : null;
  await ctx.db.insert("syncConflicts", {
    ...args,
    detectedAt: Date.now(),
    status: resolution ? "resolved" : "open",
    resolution: resolution ?? undefined,
    resolvedAt: resolution ? Date.now() : undefined,
  });
}

async function markConflictResolution(
  ctx: MutationCtx,
  losingEventId: string,
  resolution: ConflictResolution,
  resolvedAt: number,
) {
  await setSetting(ctx, `resolvedConflict:${losingEventId}`, resolution);
  const conflict = await ctx.db
    .query("syncConflicts")
    .withIndex("by_losingEventId", (q) => q.eq("losingEventId", losingEventId))
    .unique();
  if (conflict) {
    await ctx.db.patch(conflict._id, {
      status: "resolved",
      resolution,
      resolvedAt,
    });
  }
}

async function getEntityHead(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  entityType: "cr" | "assistantChat",
  entityKey: string,
) {
  return await ctx.db
    .query("syncEntityHeads")
    .withIndex("by_entityType_and_entityKey", (q) =>
      q.eq("entityType", entityType).eq("entityKey", entityKey),
    )
    .unique();
}

async function setEntityHead(
  ctx: MutationCtx,
  head: {
    entityType: "cr" | "assistantChat";
    entityKey: string;
    eventId: string;
    logicalTime: number;
    updatedAt: number;
  },
) {
  const existing = await getEntityHead(ctx, head.entityType, head.entityKey);
  if (existing) await ctx.db.replace(existing._id, head);
  else await ctx.db.insert("syncEntityHeads", head);
}

function compareEventRank(
  leftTime: number,
  leftEventId: string,
  rightTime: number,
  rightEventId: string,
) {
  return leftTime - rightTime || leftEventId.localeCompare(rightEventId);
}

async function deleteCrAggregate(ctx: MutationCtx, crId: Id<"crs">) {
  await deleteCrChildren(ctx, crId);
  await ctx.db.delete(crId);
}

async function deleteCrChildren(ctx: MutationCtx, crId: Id<"crs">) {
  const groups = await Promise.all([
    ctx.db
      .query("crUpdates")
      .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", crId))
      .take(500),
    ctx.db
      .query("crActions")
      .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", crId))
      .take(500),
    ctx.db
      .query("crApprovals")
      .withIndex("by_crId_and_createdAt", (q) => q.eq("crId", crId))
      .take(500),
    ctx.db
      .query("crWhiteboardPositions")
      .withIndex("by_crId", (q) => q.eq("crId", crId))
      .take(500),
    ctx.db
      .query("crWorkflowRequirementChecks")
      .withIndex("by_crId", (q) => q.eq("crId", crId))
      .take(500),
  ]);
  for (const rows of groups)
    for (const row of rows) await ctx.db.delete(row._id);
}

async function requireSyncSecret(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  secret: string,
) {
  const expected = await getSetting(ctx, "secret");
  if (!expected || expected !== secret) throw new Error("Invalid sync secret.");
}

async function requireAuthenticatedUser(
  ctx: Pick<QueryCtx | MutationCtx, "auth">,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required.");
  return identity;
}

async function getSetting(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  key: string,
) {
  const row = await ctx.db
    .query("syncSettings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return row?.value ?? null;
}

async function setSetting(ctx: MutationCtx, key: string, value: string) {
  const row = await ctx.db
    .query("syncSettings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (row) await ctx.db.patch(row._id, { value });
  else await ctx.db.insert("syncSettings", { key, value });
}

function parsePayload(payload: string): SyncPayload {
  const parsed = JSON.parse(payload) as Partial<SyncPayload>;
  if (parsed.kind !== "cr" && parsed.kind !== "assistantChat") {
    throw new Error("Invalid shared sync payload.");
  }
  return parsed as SyncPayload;
}

function stripSystem<T extends { _id: unknown; _creationTime: number }>(
  row: T,
): Omit<T, "_id" | "_creationTime"> {
  const { _id, _creationTime, ...data } = row;
  void _id;
  void _creationTime;
  return data;
}

function stripChild<
  T extends { _id: unknown; _creationTime: number; crId: unknown },
>(row: T): Omit<T, "_id" | "_creationTime" | "crId"> {
  const { _id, _creationTime, crId, ...data } = row;
  void _id;
  void _creationTime;
  void crId;
  return data;
}
