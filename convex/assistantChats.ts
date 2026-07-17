import { v } from "convex/values";
import {
  mutation,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server";
import { queueAssistantChatSnapshot } from "./sync";

const messageValidator = v.object({
  role: v.union(v.literal("assistant"), v.literal("user")),
  content: v.string(),
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const ownerKey = await authenticatedOwnerKey(ctx);
    return await ctx.db
      .query("assistantChatSessions")
      .withIndex("by_ownerKey_and_updatedAt", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(100);
  },
});

export const recentMemory = query({
  args: { excludeChatId: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const ownerKey = await authenticatedOwnerKey(ctx);
    const sessions = await ctx.db
      .query("assistantChatSessions")
      .withIndex("by_ownerKey_and_isDeleted_and_updatedAt", (q) =>
        q.eq("ownerKey", ownerKey).eq("isDeleted", false),
      )
      .order("desc")
      .take(8);
    return sessions
      .filter((session) => session.chatId !== args.excludeChatId)
      .slice(0, 5)
      .map((session) => ({
        title: session.title,
        updatedAt: session.updatedAt,
        messages: session.messages.slice(-8),
      }));
  },
});

export const save = mutation({
  args: {
    chatId: v.string(),
    title: v.string(),
    messages: v.array(messageValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const ownerKey = await authenticatedOwnerKey(ctx);
    const chatId = args.chatId.trim();
    if (!chatId) throw new Error("Chat ID is required.");
    const existing = await ctx.db
      .query("assistantChatSessions")
      .withIndex("by_ownerKey_and_chatId", (q) =>
        q.eq("ownerKey", ownerKey).eq("chatId", chatId),
      )
      .unique();
    if (existing && existing.updatedAt > args.updatedAt) return existing._id;

    const data = {
      ownerKey,
      chatId,
      title: args.title.trim().slice(0, 120) || "New chat",
      messages: args.messages.slice(-100).map((message) => ({
        role: message.role,
        content: message.content.slice(0, 20_000),
      })),
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
      isDeleted: false,
    };
    const id = existing
      ? (await ctx.db.replace(existing._id, data), existing._id)
      : await ctx.db.insert("assistantChatSessions", data);
    const chat = await ctx.db.get(id);
    if (chat) await queueAssistantChatSnapshot(ctx, chat);
    return id;
  },
});

export const remove = mutation({
  args: { chatId: v.string(), updatedAt: v.number() },
  handler: async (ctx, args) => {
    const ownerKey = await authenticatedOwnerKey(ctx);
    const chat = await ctx.db
      .query("assistantChatSessions")
      .withIndex("by_ownerKey_and_chatId", (q) =>
        q.eq("ownerKey", ownerKey).eq("chatId", args.chatId),
      )
      .unique();
    if (!chat || chat.updatedAt > args.updatedAt) return null;
    await ctx.db.patch(chat._id, {
      isDeleted: true,
      updatedAt: args.updatedAt,
    });
    const deleted = await ctx.db.get(chat._id);
    if (deleted) await queueAssistantChatSnapshot(ctx, deleted);
    return null;
  },
});

async function authenticatedOwnerKey(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required.");
  return (
    identity.email?.trim().toLowerCase() || identity.tokenIdentifier
  ).slice(0, 320);
}
