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
});

export const configure = mutation({
  args: { secret: v.string(), hubId: v.string() },
  handler: async (ctx, args) => {
    await setSetting(ctx, "secret", args.secret);
    await setSetting(ctx, "hubId", args.hubId);
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
      if (payload.kind === "cr") {
        await applyCrPayload(ctx, payload, event.updatedAt);
      } else {
        await applyAssistantChatPayload(ctx, payload, event.updatedAt);
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
  await enqueue(ctx, "cr", cr.crNumber, updatedAt, payload);
}

export async function queueCrDeletion(
  ctx: MutationCtx,
  crNumber: string,
  updatedAt = Date.now(),
) {
  const payload: CrTombstone = { kind: "cr", deleted: true, crNumber };
  await enqueue(ctx, "cr", crNumber, updatedAt, payload);
}

export async function queueAssistantChatSnapshot(
  ctx: MutationCtx,
  chat: Doc<"assistantChatSessions">,
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
  );
}

async function enqueue(
  ctx: MutationCtx,
  entityType: "cr" | "assistantChat",
  entityKey: string,
  updatedAt: number,
  payload: SyncPayload,
) {
  await ctx.db.insert("syncOutbox", {
    eventId: crypto.randomUUID(),
    entityType,
    entityKey,
    updatedAt,
    payload: JSON.stringify(payload),
  });
}

async function applyCrPayload(
  ctx: MutationCtx,
  payload: CrSnapshot | CrTombstone,
  updatedAt: number,
) {
  const crNumber = payload.deleted ? payload.crNumber : payload.cr.crNumber;
  const existing = await ctx.db
    .query("crs")
    .withIndex("by_crNumber", (q) => q.eq("crNumber", crNumber))
    .unique();
  if (existing && existing.lastUpdatedAt > updatedAt) return;

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
) {
  const chat = payload.chat;
  const existing = await ctx.db
    .query("assistantChatSessions")
    .withIndex("by_ownerKey_and_chatId", (q) =>
      q.eq("ownerKey", chat.ownerKey).eq("chatId", chat.chatId),
    )
    .unique();
  if (existing && existing.updatedAt > updatedAt) return;
  const next = { ...chat, updatedAt };
  if (existing) await ctx.db.replace(existing._id, next);
  else await ctx.db.insert("assistantChatSessions", next);
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
