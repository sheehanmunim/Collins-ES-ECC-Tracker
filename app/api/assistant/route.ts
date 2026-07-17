import { api } from "@/convex/_generated/api";
import {
  fetchAuthMutation,
  fetchAuthQuery,
  isAuthenticated,
} from "@/lib/auth-server";
import { requestOllamaChat } from "@/lib/ollama";
import localModelsConfig from "@/config/local-models.json";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

type IncomingMessage = {
  role: "assistant" | "user";
  content: string;
};

type AssistantImage = {
  mimeType?: string;
  base64?: string;
};

type AssistantRequest = {
  messages?: IncomingMessage[];
  chatId?: string | null;
  selectedCrNumber?: string | null;
  image?: AssistantImage | null;
  mode?: "text" | "voice";
  currentUser?: {
    localOwner?: string | null;
    name?: string | null;
    email?: string | null;
  } | null;
};

type AssistantServiceResponse = {
  message?: {
    content?: string;
  };
};

type AssistantChatMessage = {
  role: "assistant" | "system" | "user";
  content: string;
  images?: string[];
};

type AssistantContextRow = {
  crNumber?: string;
  title?: string;
  status?: string;
  priority?: string;
  risk?: string;
  category?: string;
  owner?: string;
  requester?: string;
  system?: string;
  targetDate?: string | null;
  submittedDate?: string;
  description?: string;
  businessImpact?: string;
  technicalNotes?: string;
  tags?: string[];
  eccBoard?: string;
  classification?: string;
  currentGate?: string;
  meetingDate?: string | null;
  meetingTimeEst?: string;
  ncdocNumber?: string;
  classGateMilitarySupplierEc?: string;
  eccCoordinator?: string;
  responsibleIpts?: string[];
  enginePrograms?: string[];
  componentModels?: string[];
  supplier?: string;
  documentationDeadline?: string | null;
  quorum?: string[];
  documentationNotificationStatus?: string;
  preMeetingReviewStatus?: string;
  meetingAttendanceStatus?: string;
  postMeetingPdfStatus?: string;
  ncdocStatus?: string;
  xclassStatus?: string;
  oocApprovalStatus?: string;
  chairApprovalStatus?: string;
  closureNotificationStatus?: string;
  cmWorkingListStatus?: string;
  waiverOption?: string | null;
  designAuthority?: string;
  disposition?: string;
  openActions?: Array<{
    gate?: string;
    owner?: string;
    body?: string;
    status?: string;
    dueDate?: string | null;
    evidenceLocation?: string;
  }>;
  approvals?: Array<{
    gate?: string;
    approverName?: string;
    role?: string;
    status?: string;
    source?: string;
    evidenceLocation?: string;
    sentAt?: string;
    approvedAt?: string;
  }>;
  latestUpdates?: Array<{
    body?: string;
    author?: string;
    kind?: string;
    createdAt?: number;
  }>;
};

type AssistantContextResponse = {
  generatedAt?: number;
  totalInContext?: number;
  missing?: string[];
  crs?: AssistantContextRow[];
};

type WorkflowStatus =
  | "Ready for Review"
  | "Closed"
  | "NCDOC/xClass"
  | "Pending OOC Approvals"
  | "CM Working List";

type WorkflowTaskState = "Complete" | "In Progress" | "Not Applicable";

type AssistantClassification =
  | "TBD"
  | "Class Concurrence"
  | "Class I"
  | "Class II"
  | "Waiver"
  | "Admin/NonTech";

type AssistantReviewGate =
  | "None"
  | "CC"
  | "CII"
  | "G1"
  | "G2"
  | "G3"
  | "G4"
  | "P&C"
  | "Waiver"
  | "Delta Review";

type AssistantWorkflowCommand = {
  crNumber: string;
  sourceText: string;
  title: string;
  status?: WorkflowStatus;
  eccScope?: string;
  previousWork?: string;
  disposition?: string;
  owner?: string;
  requester?: string;
  waiverOption?: string | null;
  classification?: AssistantClassification;
  currentGate?: AssistantReviewGate;
  preMeetingReviewStatus?: WorkflowTaskState;
  ncdocStatus?: WorkflowTaskState;
  xclassStatus?: WorkflowTaskState;
  oocApprovalStatus?: WorkflowTaskState;
  closureNotificationStatus?: WorkflowTaskState;
  cmWorkingListStatus?: WorkflowTaskState;
  author: string;
};

type AssistantWorkflowResult = {
  crId: string;
  crNumber: string;
  operation: "created" | "updated";
  status: WorkflowStatus | string;
};

const DEFAULT_MODEL = localModelsConfig.profiles.balanced.chat;
const DEFAULT_VOICE_MODEL = localModelsConfig.profiles.balanced.voice;
const DEFAULT_VISION_MODEL = localModelsConfig.profiles.balanced.vision;
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

export async function POST(request: Request) {
  const body = (await request
    .json()
    .catch(() => null)) as AssistantRequest | null;
  const messages = normalizeMessages(body?.messages ?? []);

  if (messages.length === 0) {
    return NextResponse.json(
      { error: "Send at least one message to ask about CRs." },
      { status: 400 },
    );
  }

  if (!(await isAuthenticated())) {
    return NextResponse.json(
      { error: "Sign in to use the ECC assistant." },
      { status: 401 },
    );
  }

  const selectedCrNumber = body?.selectedCrNumber ?? null;
  const localOwner = cleanText(
    body?.currentUser?.localOwner ||
      body?.currentUser?.name ||
      body?.currentUser?.email ||
      "",
  );
  const createClarificationAnswer = buildCreateCrClarificationAnswer(
    messages,
    selectedCrNumber,
  );
  if (createClarificationAnswer) {
    return NextResponse.json({ answer: createClarificationAnswer });
  }
  const workflowCommand = parseAssistantWorkflowCommand(
    messages,
    selectedCrNumber,
    localOwner,
  );

  if (workflowCommand) {
    try {
      const result = (await fetchAuthMutation(
        api.crs.upsertFromAssistant,
        workflowCommand,
      )) as AssistantWorkflowResult;

      return NextResponse.json({
        answer: buildWorkflowActionAnswer(result, workflowCommand),
        workflowResult: result,
      });
    } catch (error) {
      console.error("Assistant workflow update failed", error);
      return NextResponse.json(
        {
          error:
            "I understood the workflow update, but could not save it to the CR register.",
        },
        { status: 500 },
      );
    }
  }

  const imageBase64 = cleanImageBase64(body?.image?.base64 ?? "");
  const isVoiceMode = body?.mode === "voice" && !imageBase64;
  const model = imageBase64
    ? (process.env.OLLAMA_VISION_MODEL ?? DEFAULT_VISION_MODEL)
    : isVoiceMode
      ? (process.env.OLLAMA_VOICE_MODEL ??
        process.env.OLLAMA_MODEL ??
        DEFAULT_VOICE_MODEL)
      : (process.env.OLLAMA_MODEL ?? DEFAULT_MODEL);
  const voiceModel =
    process.env.OLLAMA_VOICE_MODEL ??
    process.env.OLLAMA_MODEL ??
    DEFAULT_VOICE_MODEL;
  const visionModel = process.env.OLLAMA_VISION_MODEL ?? DEFAULT_VISION_MODEL;
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_URL;
  const requestedCrNumbers = findRequestedCrNumbers(messages, selectedCrNumber);
  const modelAnswer = buildModelQuestionAnswer(messages, {
    text: process.env.OLLAMA_MODEL ?? DEFAULT_MODEL,
    voice: voiceModel,
    vision: visionModel,
  });
  if (modelAnswer) {
    return NextResponse.json({ answer: modelAnswer });
  }
  const needsCrContext = shouldUseCrContext(
    messages,
    requestedCrNumbers,
    selectedCrNumber,
    Boolean(imageBase64),
  );
  const contextPayload = needsCrContext
    ? normalizeAssistantContextResponse(
        await fetchAuthQuery(api.crs.assistantContext, {
          limit: isVoiceMode ? 35 : 120,
        }),
      )
    : { crs: [] };
  const directCrContext =
    requestedCrNumbers.length > 0
      ? normalizeAssistantContextResponse(
          await fetchAuthQuery(api.crs.assistantCrDetails, {
            crNumbers: requestedCrNumbers,
          }),
        )
      : null;
  const contextRows = mergeAssistantContextRows(
    directCrContext?.crs ?? [],
    contextPayload.crs ?? [],
  );
  const crDetailAnswer = buildCrDetailQuestionAnswer(
    messages,
    contextRows,
    requestedCrNumbers,
    directCrContext?.missing ?? [],
  );
  if (crDetailAnswer) {
    return NextResponse.json({ answer: crDetailAnswer });
  }
  const ownerAnswer = buildOwnerQuestionAnswer(
    messages,
    contextRows,
    localOwner,
  );
  if (ownerAnswer) {
    return NextResponse.json({ answer: ownerAnswer });
  }
  const processKnowledge = needsCrContext ? await readProcessKnowledge() : "";
  const priorChatMemory = await fetchAuthQuery(
    api.assistantChats.recentMemory,
    {
      excludeChatId: body?.chatId?.trim() || null,
    },
  );
  const contextLimit = isVoiceMode ? 12_000 : 30_000;

  const systemPrompt = [
    "You are an ECC assistant for Collins Aerospace engineering change requests.",
    needsCrContext
      ? "Use only the CR data provided in the JSON context. If the data does not answer the question, say what is missing."
      : "If the user is making casual conversation or asking a general question, answer normally and briefly.",
    "Be concise, practical, and specific. Mention CR numbers when making claims.",
    "Format readable responses in Markdown: use short paragraphs, **bold** labels sparingly, and real bullet or numbered lists with blank lines between sections. Do not output raw checklist text unless the user asks for a literal template.",
    "Keep a professional tone and do not use emojis.",
    isVoiceMode
      ? "The user is in live voice mode. Answer conversationally in 1 to 3 short sentences unless they ask for detail."
      : "",
    "If the user attaches a screenshot with CR intake notes, read the screenshot and extract the PWES Military ECC fields. Read digits exactly and double-check CR numbers, dates, and charge numbers. Map Presenter to ECC Coordinator, Timestamp or Timeslot to Meeting Date and Time, Provide Collins CR to Collins CR # / PW REA #, CR Title/Description to Description, Engine Programs affected to Engine Program(s), Review being requested and CR Classification to Class/Gate/Military Supplier EC, Component Model name to Component Model(s), and Open Charge Number to Charge Number.",
    "For CM Working List questions, use the EC-35200 process knowledge and treat CM Working List as CM readiness work, not final CR closure.",
    "Do not reveal chain-of-thought or use think tags.",
    selectedCrNumber
      ? `The user currently has ${selectedCrNumber} selected in the UI.`
      : "No CR is currently selected in the UI.",
    localOwner
      ? `The current local owner/user is "${localOwner}". Treat "me", "my", "mine", and "myself" as this user unless the user says otherwise.`
      : "The current local owner/user was not provided. If the user asks about 'my' CRs, say the local owner is missing.",
    priorChatMemory.length > 0
      ? `Relevant memory from this user's previous local AI chats. Treat it as conversational background, not authoritative CR data:\n${JSON.stringify(priorChatMemory)}`
      : "No previous AI chat memory is available for this user.",
    `Current timestamp: ${new Date().toISOString()}.`,
    needsCrContext ? `ECC process knowledge:\n${processKnowledge}` : "",
    needsCrContext
      ? `CR JSON context:\n${JSON.stringify(
          {
            ...contextPayload,
            crs: contextRows,
          },
          null,
          2,
        ).slice(0, contextLimit)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const chatMessages: AssistantChatMessage[] = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    if (imageBase64) {
      const lastUserIndex = findLastUserMessageIndex(chatMessages);
      if (lastUserIndex === -1) {
        chatMessages.push({
          role: "user",
          content:
            "Read the attached screenshot and extract the PWES Military ECC CR intake details.",
          images: [imageBase64],
        });
      } else {
        chatMessages[lastUserIndex] = {
          ...chatMessages[lastUserIndex],
          images: [imageBase64],
        };
      }
    }

    const ollamaResponse = await requestOllamaChat({
      ollamaBaseUrl,
      model,
      stream: false,
      think: false,
      messages: [{ role: "system", content: systemPrompt }, ...chatMessages],
      options: {
        temperature: isVoiceMode ? 0.35 : 0.25,
        num_predict: isVoiceMode ? 220 : 520,
        num_ctx: needsCrContext ? (isVoiceMode ? 8192 : 16384) : 4096,
      },
      keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? "30m",
    });

    if (!ollamaResponse.ok) {
      await ollamaResponse.text();
      return NextResponse.json(
        {
          error:
            "The ECC assistant is temporarily unavailable. Please try again later.",
        },
        { status: 502 },
      );
    }

    const data = (await ollamaResponse.json()) as AssistantServiceResponse;
    let answer = data.message?.content?.trim();

    if (isSuspiciousAssistantAnswer(answer, messages)) {
      answer = await retryWithConversationalModel({
        ollamaBaseUrl,
        model: voiceModel,
        messages: [{ role: "system", content: systemPrompt }, ...chatMessages],
        isVoiceMode,
        needsCrContext,
      });
    }

    return NextResponse.json({
      answer:
        answer ||
        "The ECC assistant did not return a response. Please try again.",
    });
  } catch (error) {
    console.error("Assistant service request failed", error);
    return NextResponse.json(
      {
        error:
          "The ECC assistant is temporarily unavailable. Please try again later.",
      },
      { status: 502 },
    );
  }
}

function findLastUserMessageIndex(messages: AssistantChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return index;
    }
  }
  return -1;
}

function cleanImageBase64(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").trim();
}

function buildModelQuestionAnswer(
  messages: IncomingMessage[],
  models: { text: string; voice: string; vision: string },
) {
  const latestUserMessage = findLastUserMessage(messages);
  if (!latestUserMessage || !isModelQuestion(latestUserMessage.content)) {
    return null;
  }

  return `I am running locally through Ollama. Text chat uses ${models.text}, voice chat uses ${models.voice}, and screenshot review uses ${models.vision}.`;
}

function isModelQuestion(value: string) {
  const text = value.toLowerCase();
  return (
    /\b(what|which|who)\b/.test(text) &&
    /\b(model|llm|ai|are you|running|using)\b/.test(text)
  );
}

function shouldUseCrContext(
  messages: IncomingMessage[],
  requestedCrNumbers: string[],
  selectedCrNumber: string | null,
  hasImage: boolean,
) {
  if (hasImage || requestedCrNumbers.length > 0 || selectedCrNumber) {
    return true;
  }

  const latestUserMessage = findLastUserMessage(messages);
  if (!latestUserMessage) {
    return false;
  }

  const latestText = latestUserMessage.content.toLowerCase();
  if (mentionsCrWork(latestText)) {
    return true;
  }

  if (
    /^(what|why|how|wdym|explain|more|tell me more|ok|okay)\??$/i.test(
      latestText.trim(),
    )
  ) {
    return messages
      .slice(-5)
      .some((message) => mentionsCrWork(message.content.toLowerCase()));
  }

  return false;
}

function mentionsCrWork(value: string) {
  return /\b(crs?|change requests?|ecc|review|blockers?|blocked|high-risk|risk|owner|assigned|due|target date|approval|approvals|actions?|ooc|ncdoc|xclass|closure|meeting|intake|documentation|quorum|evidence|workflow|waiver|gate|supplier|program|ipt|cm|configuration management|working list|plm|epec|change order|priority code|wlox|cs queue|cm queue)\b/.test(
    value,
  );
}

function isSuspiciousAssistantAnswer(
  answer: string | undefined,
  messages: IncomingMessage[],
) {
  const text = cleanText(answer);
  if (!text) {
    return true;
  }

  const latestUserMessage = findLastUserMessage(messages);
  const latestText = cleanText(latestUserMessage?.content);
  if (latestText.length < 4) {
    return false;
  }

  const normalized = text.toLowerCase().replace(/[.!?]+$/g, "");
  return (
    ["i", "based", "why", "okay"].includes(normalized) ||
    (text.split(/\s+/).length === 1 && latestText.split(/\s+/).length >= 3)
  );
}

async function retryWithConversationalModel({
  ollamaBaseUrl,
  model,
  messages,
  isVoiceMode,
  needsCrContext,
}: {
  ollamaBaseUrl: string;
  model: string;
  messages: AssistantChatMessage[];
  isVoiceMode: boolean;
  needsCrContext: boolean;
}) {
  const response = await requestOllamaChat({
    ollamaBaseUrl,
    model,
    stream: false,
    messages,
    options: {
      temperature: isVoiceMode ? 0.35 : 0.3,
      num_predict: isVoiceMode ? 220 : 420,
      num_ctx: needsCrContext ? 8192 : 4096,
    },
    keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? "30m",
  });

  if (!response.ok) {
    await response.text().catch(() => "");
    return "";
  }

  const data = (await response.json()) as AssistantServiceResponse;
  return data.message?.content?.trim() ?? "";
}

function normalizeAssistantContextResponse(
  value: unknown,
): AssistantContextResponse {
  if (Array.isArray(value)) {
    return { crs: value as AssistantContextRow[] };
  }

  if (!value || typeof value !== "object") {
    return { crs: [] };
  }

  const payload = value as AssistantContextResponse;
  return {
    ...payload,
    crs: Array.isArray(payload.crs) ? payload.crs : [],
    missing: Array.isArray(payload.missing) ? payload.missing : [],
  };
}

function mergeAssistantContextRows(
  primaryRows: AssistantContextRow[],
  secondaryRows: AssistantContextRow[],
) {
  const seen = new Set<string>();
  const rows: AssistantContextRow[] = [];

  for (const row of [...primaryRows, ...secondaryRows]) {
    const crNumber = normalizeCrNumber(row.crNumber ?? "");
    if (!crNumber || seen.has(crNumber)) {
      continue;
    }
    seen.add(crNumber);
    rows.push(row);
  }

  return rows;
}

function findRequestedCrNumbers(
  messages: IncomingMessage[],
  selectedCrNumber: string | null,
) {
  const latestUserMessage = findLastUserMessage(messages);
  const requested = [
    ...(latestUserMessage ? findCrNumbers(latestUserMessage.content) : []),
    selectedCrNumber ?? "",
  ]
    .map(normalizeCrNumber)
    .filter(Boolean);

  return Array.from(new Set(requested));
}

function buildCrDetailQuestionAnswer(
  messages: IncomingMessage[],
  context: AssistantContextRow[],
  requestedCrNumbers: string[],
  missingCrNumbers: string[],
) {
  const latestUserMessage = findLastUserMessage(messages);
  if (
    !latestUserMessage ||
    requestedCrNumbers.length === 0 ||
    !isCrDetailQuestion(latestUserMessage.content)
  ) {
    return null;
  }

  const rowsByCrNumber = new Map(
    context
      .map((row) => [normalizeCrNumber(row.crNumber ?? ""), row] as const)
      .filter(([crNumber]) => crNumber),
  );
  const foundRows = requestedCrNumbers
    .map((crNumber) => rowsByCrNumber.get(crNumber))
    .filter((row): row is AssistantContextRow => Boolean(row));
  const missing = requestedCrNumbers.filter(
    (crNumber) => !rowsByCrNumber.has(crNumber),
  );
  const explicitlyMissing = Array.from(
    new Set(
      [...missing, ...missingCrNumbers.map(normalizeCrNumber)].filter(Boolean),
    ),
  );

  if (foundRows.length === 0) {
    return `I could not find ${requestedCrNumbers.join(
      ", ",
    )} in the active CR register. It may be archived, not loaded in this local database, or the CR number may be different.`;
  }

  const summaries = foundRows.map(formatCrDetailSummary).join("\n\n");
  const missingNote =
    explicitlyMissing.length > 0
      ? `\n\nI could not find ${explicitlyMissing.join(", ")} in the active CR register.`
      : "";

  return `${summaries}${missingNote}`;
}

function isCrDetailQuestion(value: string) {
  const text = value.toLowerCase();
  if (!/\bcr[-\s_]*\d{1,7}\b/i.test(value)) {
    return false;
  }

  return (
    /\b(tell|about|detail|details|status|summary|summarize|what|show|info|risk|owner|due|date|priority|block|action|approval|cm|working list|plm|where|who|when|describe|explain)\b/.test(
      text,
    ) || /^cr[-\s_]*\d{1,7}$/i.test(value.trim())
  );
}

function formatCrDetailSummary(cr: AssistantContextRow) {
  const title = cleanText(cr.title) || "Untitled";
  const overview = [
    cr.status ? `status ${cr.status}` : "",
    cr.priority ? `${cr.priority} priority` : "",
    cr.risk ? `${cr.risk} risk` : "",
    cr.currentGate && cr.currentGate !== "None" ? `gate ${cr.currentGate}` : "",
  ].filter(Boolean);
  const people = [
    cleanText(cr.owner) ? `owner ${cr.owner}` : "",
    cleanText(cr.eccCoordinator) ? `ECC coordinator ${cr.eccCoordinator}` : "",
    cleanText(cr.requester) ? `requester ${cr.requester}` : "",
  ].filter(Boolean);
  const dates = [
    cr.targetDate ? `target ${cr.targetDate}` : "",
    cr.documentationDeadline ? `docs due ${cr.documentationDeadline}` : "",
    cr.meetingDate
      ? `meeting ${cr.meetingDate}${cr.meetingTimeEst ? ` ${cr.meetingTimeEst}` : ""}`
      : "",
  ].filter(Boolean);
  const scope = [
    cleanText(cr.eccBoard) ? cr.eccBoard : "",
    cleanText(cr.classification) && cr.classification !== "TBD"
      ? cr.classification
      : "",
    cleanText(cr.system) ? cr.system : "",
  ].filter(Boolean);
  const workflow = [
    cr.documentationNotificationStatus
      ? `docs ${cr.documentationNotificationStatus}`
      : "",
    cr.preMeetingReviewStatus ? `pre-review ${cr.preMeetingReviewStatus}` : "",
    cr.oocApprovalStatus ? `OOC ${cr.oocApprovalStatus}` : "",
    cr.ncdocStatus ? `NCDOC ${cr.ncdocStatus}` : "",
    cr.xclassStatus ? `xClass ${cr.xclassStatus}` : "",
    cr.cmWorkingListStatus ? `CM list ${cr.cmWorkingListStatus}` : "",
    cr.closureNotificationStatus
      ? `closure ${cr.closureNotificationStatus}`
      : "",
  ].filter(Boolean);
  const openActions = (cr.openActions ?? []).slice(0, 3);
  const latestUpdate = cr.latestUpdates?.[0];
  const lines = [
    `${normalizeCrNumber(cr.crNumber ?? "") || "CR"}: ${title}`,
    overview.length > 0 ? `Current state: ${overview.join("; ")}.` : "",
    people.length > 0 ? `People: ${people.join("; ")}.` : "",
    dates.length > 0 ? `Dates: ${dates.join("; ")}.` : "",
    scope.length > 0 ? `Scope: ${scope.join("; ")}.` : "",
    meaningfulText(cr.description)
      ? `Description: ${truncateForAssistant(cr.description, 360)}`
      : "",
    meaningfulText(cr.businessImpact)
      ? `Impact: ${truncateForAssistant(cr.businessImpact, 260)}`
      : "",
    meaningfulText(cr.disposition)
      ? `Disposition: ${truncateForAssistant(cr.disposition, 220)}`
      : "",
    workflow.length > 0 ? `Workflow: ${workflow.join("; ")}.` : "",
    openActions.length > 0
      ? `Open actions: ${openActions
          .map((action) =>
            [
              cleanText(action.gate) || "Action",
              cleanText(action.owner) ? `owner ${action.owner}` : "",
              cleanText(action.dueDate) ? `due ${action.dueDate}` : "",
              truncateForAssistant(action.body, 120),
            ]
              .filter(Boolean)
              .join(" - "),
          )
          .join("; ")}.`
      : "",
    latestUpdate && meaningfulText(latestUpdate.body)
      ? `Latest update: ${truncateForAssistant(latestUpdate.body, 180)}`
      : "",
  ];

  return lines.filter(Boolean).join("\n");
}

function meaningfulText(value: unknown) {
  const text = cleanText(value);
  const normalized = text.toLowerCase().replace(/[.\s]+$/g, "");
  return (
    text.length > 0 &&
    ![
      "not specified",
      "none",
      "n/a",
      "unknown",
      "no description provided",
    ].includes(normalized)
  );
}

function truncateForAssistant(value: unknown, maxLength: number) {
  const text = cleanText(value);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function findCrNumbers(value: string) {
  return Array.from(value.matchAll(/\bCR[-\s_]*(\d{1,7})\b/gi)).map(
    (match) => match[0],
  );
}

function buildOwnerQuestionAnswer(
  messages: IncomingMessage[],
  context: AssistantContextRow[],
  localOwner: string,
) {
  const latestUserMessage = findLastUserMessage(messages);
  if (!latestUserMessage) {
    return null;
  }

  const sourceText = latestUserMessage.content
    .replace(/\[Screenshot attached\]/gi, "")
    .trim();
  if (!isOwnerQuestion(sourceText)) {
    return null;
  }

  if (!localOwner) {
    return "I can answer that, but your local owner name is not set. Set it in Settings so I know who 'myself' refers to.";
  }

  const ownerKey = personIdentityKey(localOwner);
  const matches = context.filter((cr) =>
    peopleLinkedToAssistantCr(cr).some(
      (person) => personIdentityKey(person) === ownerKey,
    ),
  );

  if (matches.length === 0) {
    return `I did not find any active CRs linked to ${localOwner} in the current CR context.`;
  }

  const rows = matches
    .slice(0, 12)
    .map((cr) => {
      const detailParts = [
        cr.status,
        cr.priority ? `${cr.priority} priority` : "",
        cr.risk ? `${cr.risk} risk` : "",
        cr.targetDate ? `target ${cr.targetDate}` : "",
      ].filter(Boolean);
      return `- ${cr.crNumber ?? "Unknown CR"}: ${cr.title ?? "Untitled"}${
        detailParts.length > 0 ? ` (${detailParts.join(", ")})` : ""
      }`;
    })
    .join("\n");
  const truncated =
    matches.length > 12 ? `\n\nShowing 12 of ${matches.length} matches.` : "";

  return `I found ${matches.length} active CR${
    matches.length === 1 ? "" : "s"
  } linked to ${localOwner}:\n\n${rows}${truncated}`;
}

function isOwnerQuestion(value: string) {
  const text = value.toLowerCase();
  const mentionsCr = /\bcrs?\b|change requests?/.test(text);
  const mentionsSelf =
    /\b(my|mine|me|myself|assigned to myself|assigned to me)\b/.test(text);
  const asksForList =
    /\b(what|which|show|list|give|find|do i have|assigned)\b/.test(text);
  return mentionsCr && mentionsSelf && asksForList;
}

function peopleLinkedToAssistantCr(cr: AssistantContextRow) {
  return [
    cr.owner ?? "",
    cr.eccCoordinator ?? "",
    cr.requester ?? "",
    ...(cr.responsibleIpts ?? []),
    ...(cr.quorum ?? []),
  ].filter((person) => cleanText(person) && !isPlaceholderPerson(person));
}

function personIdentityKey(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();
}

function isPlaceholderPerson(value: string) {
  return ["unassigned", "unknown", "not set", "ipt", "collins user"].includes(
    cleanText(value).toLowerCase(),
  );
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function buildCreateCrClarificationAnswer(
  messages: IncomingMessage[],
  selectedCrNumber: string | null,
) {
  const latestUserMessage = findLastUserMessage(messages);
  if (!latestUserMessage) {
    return null;
  }

  const sourceText = latestUserMessage.content
    .replace(/\[Screenshot attached\]/gi, "")
    .trim();
  if (!isAssistantCreateCrIntent(sourceText)) {
    return null;
  }

  const crNumber = normalizeCrNumber(
    findCrNumber(sourceText) || selectedCrNumber || "",
  );
  if (!crNumber) {
    return "Yes. Send me the CR number and a short title or description first, and I will create it in My CRs. Optional fields that help: target date, owner or IPT, ECC scope, and whether CC/CII are complete.";
  }

  if (!hasAssistantCreateDetails(sourceText)) {
    return `I can create ${crNumber} in My CRs. What short title or description should I use? Optional fields that help: target date, owner or IPT, ECC scope, and whether CC/CII are complete.`;
  }

  return null;
}

function parseAssistantWorkflowCommand(
  messages: IncomingMessage[],
  selectedCrNumber: string | null,
  localOwner: string,
): AssistantWorkflowCommand | null {
  const latestUserMessage = findLastUserMessage(messages);
  if (!latestUserMessage) {
    return null;
  }

  const sourceText = latestUserMessage.content
    .replace(/\[Screenshot attached\]/gi, "")
    .trim();
  if (!sourceText) {
    return null;
  }

  const crNumber = normalizeCrNumber(
    findCrNumber(sourceText) || selectedCrNumber || "",
  );
  if (!crNumber) {
    return null;
  }

  const mentionsClosure = /\b(?:closure|closed|closeout|close-out)\b/i.test(
    sourceText,
  );
  const mentionsOoc = /\b(?:ooc|out[-\s]?of[-\s]?cycle)\b/i.test(sourceText);
  const mentionsCmWorkingList = isCmWorkingListStatus(sourceText);
  const mentionsActualClosure = isActualClosureStatus(sourceText);
  const mentionsCreateCr = isAssistantCreateCrIntent(sourceText);
  const ccCiiComplete = isCcCiiCompleteStatus(sourceText);
  const waiverOption = extractMsEccWaiverOption(sourceText);
  const isMsEccOption1AfterCcCii =
    mentionsCreateCr && waiverOption === "MS ECC Option 1" && ccCiiComplete;
  const hasActionIntent =
    /\b(?:push(?:ed)?|move(?:d)?|set|mark(?:ed)?|update(?:d)?|create(?:d)?|add(?:ed)?|put|send|sent|submit(?:ted)?|authoriz(?:e|ed)|queue(?:d)?|route(?:d)?|screen(?:ed)?|now|done|completed|previously)\b/i.test(
      sourceText,
    );
  const cmListComplete = isCmWorkingListCompleteStatus(sourceText);

  if (
    (!mentionsCreateCr &&
      !mentionsClosure &&
      !mentionsOoc &&
      !mentionsCmWorkingList) ||
    (!mentionsCreateCr &&
      !hasActionIntent &&
      !mentionsActualClosure &&
      !cmListComplete)
  ) {
    return null;
  }

  const eccScope = extractEccScope(sourceText);
  const status: WorkflowStatus | undefined = mentionsActualClosure
    ? "Closed"
    : mentionsCmWorkingList
      ? "CM Working List"
      : isMsEccOption1AfterCcCii
        ? "NCDOC/xClass"
        : mentionsCreateCr && ccCiiComplete
          ? "Ready for Review"
          : mentionsClosure
            ? "NCDOC/xClass"
            : mentionsOoc
              ? "Pending OOC Approvals"
              : undefined;
  const oocComplete =
    mentionsOoc &&
    /\b(?:previously|done|completed|complete|approved|finished)\b/i.test(
      sourceText,
    );
  const previousWork = isMsEccOption1AfterCcCii
    ? "CC and CII"
    : oocComplete && mentionsClosure
      ? `OOC${eccScope ? ` for ${eccScope}` : ""}`
      : undefined;
  const title = mentionsCreateCr
    ? extractAssistantCreateTitle(sourceText, crNumber, eccScope, status)
    : buildWorkflowCommandTitle(crNumber, status, eccScope);
  const disposition = mentionsCreateCr
    ? buildCreateCommandDisposition(
        status,
        eccScope,
        ccCiiComplete,
        waiverOption,
      )
    : buildWorkflowCommandDisposition(status, eccScope);
  const owner = cleanText(localOwner);

  return {
    crNumber,
    sourceText,
    title,
    ...(status ? { status } : {}),
    ...(eccScope ? { eccScope } : {}),
    ...(previousWork ? { previousWork } : {}),
    ...(disposition ? { disposition } : {}),
    ...(owner ? { owner, requester: owner } : {}),
    ...(waiverOption ? { waiverOption } : {}),
    ...(ccCiiComplete
      ? {
          classification: "Class II" as const,
          currentGate: "CII" as const,
          preMeetingReviewStatus: "Complete" as const,
        }
      : {}),
    ...(isMsEccOption1AfterCcCii
      ? {
          ncdocStatus: "In Progress" as const,
          xclassStatus: "In Progress" as const,
          oocApprovalStatus: "In Progress" as const,
          closureNotificationStatus: "In Progress" as const,
          cmWorkingListStatus: "Not Applicable" as const,
        }
      : {}),
    ...(mentionsOoc
      ? { oocApprovalStatus: oocComplete ? "Complete" : "In Progress" }
      : {}),
    ...(mentionsClosure && status !== "CM Working List"
      ? {
          closureNotificationStatus: mentionsActualClosure
            ? "Complete"
            : "In Progress",
        }
      : {}),
    ...(mentionsCmWorkingList
      ? { cmWorkingListStatus: cmListComplete ? "Complete" : "In Progress" }
      : {}),
    author: "Collins AI",
  };
}

function isAssistantCreateCrIntent(value: string) {
  return /\b(?:make|create|add|start|open|draft)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:cr|change request)\b/i.test(
    value,
  );
}

function hasAssistantCreateDetails(sourceText: string) {
  const detailText = getAssistantCreateDetailText(sourceText);
  return /\b[a-z0-9][a-z0-9/&-]*\b/i.test(detailText);
}

function getAssistantCreateDetailText(sourceText: string) {
  return sourceText
    .replace(/\[Screenshot attached\]/gi, " ")
    .replace(/\bCR[-\s_]*\d{1,7}\b/gi, " ")
    .replace(
      /\b(?:make|create|add|start|open|draft)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:cr|change request)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:-]+|[\s.,;:-]+$/g, "")
    .trim();
}

function isCcCiiCompleteStatus(value: string) {
  const mentionsCc = /\bcc\b|class\s+concurrence/i.test(value);
  const mentionsCii = /\bcii\b|class\s*(?:ii|2)\b/i.test(value);
  const mentionsComplete =
    /\b(?:already|gone|went|passed|through|complete|completed|approved|done|finished)\b/i.test(
      value,
    );

  return mentionsCc && mentionsCii && mentionsComplete;
}

function extractMsEccWaiverOption(value: string) {
  const normalized = cleanText(value);
  if (!/\b(?:ms\s+ecc|military\s+supplier\s+ecc)\b/i.test(normalized)) {
    return null;
  }

  if (/\boption\s*(?:1|one)\b/i.test(normalized)) {
    return "MS ECC Option 1";
  }

  if (/\boption\s*(?:2|two)\b/i.test(normalized)) {
    return "MS ECC Option 2";
  }

  return null;
}

function extractAssistantCreateTitle(
  sourceText: string,
  crNumber: string,
  eccScope: string,
  status: WorkflowStatus | undefined,
) {
  const sentences = sourceText
    .split(/[\n.!?]+/)
    .map((sentence) => cleanText(sentence))
    .filter(Boolean);

  for (const sentence of sentences) {
    const match = sentence.match(
      /\b(?:this is|title is|called|named)\s+(.+)$/i,
    );
    const title = cleanAssistantCreateTitleCandidate(match?.[1] ?? "");
    if (title) {
      return title;
    }
  }

  for (const sentence of sentences) {
    const title = cleanAssistantCreateTitleCandidate(
      getAssistantCreateDetailText(sentence),
    );
    if (title) {
      return title;
    }
  }

  return buildWorkflowCommandTitle(crNumber, status, eccScope);
}

function cleanAssistantCreateTitleCandidate(value: string) {
  const title = cleanText(value)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(?:this\s+is|title\s+is|called|named)\s+/i, "")
    .replace(/\b(?:it'?s|it\s+is|already)\s+.*$/i, "")
    .replace(/\b(?:gone|went|passed)\s+through\s+.*$/i, "")
    .replace(/^[\s.,;:-]+|[\s.,;:-]+$/g, "")
    .trim();

  if (
    !title ||
    /^(?:a\s+)?(?:new\s+)?(?:cr|change request)$/i.test(title) ||
    /^(?:cc|cii|class ii|class concurrence)$/i.test(title)
  ) {
    return "";
  }

  return title.length > 120 ? `${title.slice(0, 117)}...` : title;
}

function buildCreateCommandDisposition(
  status: WorkflowStatus | undefined,
  eccScope: string,
  ccCiiComplete: boolean,
  waiverOption: string | null,
) {
  if (status === "NCDOC/xClass" && waiverOption === "MS ECC Option 1") {
    return `MS ECC Option 1 records closeout${
      eccScope ? ` for ${eccScope}` : ""
    }; CC and CII complete; make SAD/SAD VP reports, create NCDOC, complete xClass, send MS ECC closeout email, no CM email`;
  }

  if (status === "Ready for Review" && ccCiiComplete) {
    return `Ready for ECC review${
      eccScope ? ` for ${eccScope}` : ""
    }; CC and CII complete`;
  }

  return `Created from Collins AI request${eccScope ? ` for ${eccScope}` : ""}`;
}

function isCmWorkingListStatus(value: string) {
  return /\b(?:cm\s+working\s+list|cm\s+list|working\s+list|configuration\s+management|cm\s+queue|cs\s+queue|cmworkinglistwlox|sent\s+to\s+cm|send\s+to\s+cm|submit(?:ted)?\s+(?:the\s+)?cr\s+to\s+cm|submit(?:ted)?\s+(?:the\s+)?cr\s+to\s+workflow\s+for\s+cm|add(?:ed)?\s+(?:it\s+|this\s+|the\s+cr\s+)?to\s+(?:the\s+)?working\s+list)\b/i.test(
    value,
  );
}

function isCmWorkingListCompleteStatus(value: string) {
  return (
    isCmWorkingListStatus(value) &&
    /\b(?:added|accepted|confirmed|complete|completed|done|response|responded|unfiltered)\b/i.test(
      value,
    )
  );
}

function isActualClosureStatus(value: string) {
  return (
    /\b(?:actually|formally|fully|finally)\s+closed\b/i.test(value) ||
    /\b(?:mark(?:ed)?|set|update(?:d)?)\s+(?:it\s+|this\s+|the\s+cr\s+)?(?:as\s+)?closed\b/i.test(
      value,
    ) ||
    /\bclosure\s+(?:complete|completed|done|notification\s+(?:sent|complete|completed))\b/i.test(
      value,
    ) ||
    /\bclosed\s+out\b/i.test(value)
  );
}

function findLastUserMessage(messages: IncomingMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return messages[index];
    }
  }
  return null;
}

function findCrNumber(value: string) {
  return value.match(/\bCR[-\s_]*(\d{1,7})\b/i)?.[0] ?? "";
}

function normalizeCrNumber(value: string) {
  const match = value.trim().match(/\bCR[-\s_]*(\d{1,7})\b/i);
  if (!match) {
    return "";
  }
  return `CR-${match[1].padStart(7, "0")}`;
}

function extractEccScope(value: string) {
  const matches = Array.from(
    value.matchAll(
      /\b(?:for|to|in)\s+([A-Z][A-Z&]*(?:\s+[A-Z][A-Z&]*){0,3}\s+ECC)\b/gi,
    ),
  );
  const fallbackMatch = value.match(
    /\b(MS\s+ECC|Military\s+Supplier\s+ECC|PWES\s+Military\s+ECC)\b/i,
  );
  const match = matches.at(-1)?.[1] ?? fallbackMatch?.[1] ?? "";
  return normalizeEccScope(match);
}

function normalizeEccScope(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bms\b/gi, "MS")
    .replace(/\bpwes\b/gi, "PWES")
    .replace(/\becc\b/gi, "ECC");
}

function buildWorkflowCommandTitle(
  crNumber: string,
  status: WorkflowStatus | undefined,
  eccScope: string,
) {
  const scope = eccScope ? `${eccScope} ` : "";
  if (status === "Ready for Review") {
    return `${crNumber} - ${scope}ready for review`;
  }
  if (status === "Closed") {
    return `${crNumber} - ${scope}closure`;
  }
  if (status === "NCDOC/xClass") {
    return `${crNumber} - ${scope}NCDOC/xClass`;
  }
  if (status === "Pending OOC Approvals") {
    return `${crNumber} - ${scope}OOC`;
  }
  if (status === "CM Working List") {
    return `${crNumber} - ${scope}CM Working List`;
  }
  return `${crNumber} - ${scope}workflow update`;
}

function buildWorkflowCommandDisposition(
  status: WorkflowStatus | undefined,
  eccScope: string,
) {
  const scope = eccScope ? ` for ${eccScope}` : "";
  if (status === "Ready for Review") {
    return `Ready for ECC review${scope}`;
  }
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
  return "";
}

function buildWorkflowActionAnswer(
  result: AssistantWorkflowResult,
  command: AssistantWorkflowCommand,
) {
  const action = result.operation === "created" ? "Created" : "Updated";
  const location =
    result.operation === "created" && command.owner ? "My CRs" : "All CRs";
  const scope = command.eccScope ? ` for ${command.eccScope}` : "";
  const owner =
    result.operation === "created" && command.owner
      ? ` Assigned it to ${command.owner}.`
      : "";
  const previous = command.previousWork
    ? ` I also marked ${command.previousWork} as complete.`
    : "";

  if (command.status === "Ready for Review") {
    return `${action} ${result.crNumber} in ${location} and marked it Ready for Review${scope}.${owner}${previous} The request queue will update from the CR register.`;
  }

  if (command.status === "Closed") {
    return `${action} ${result.crNumber} in ${location} and marked it closed${scope}.${owner}${previous} The workflow view will update from the CR register.`;
  }

  if (
    command.status === "NCDOC/xClass" &&
    command.waiverOption === "MS ECC Option 1"
  ) {
    return `${action} ${result.crNumber} in ${location} and moved it into MS ECC Option 1 records/xClass closeout${scope}.${owner}${previous} It needs SAD/SAD VP reports, NCDOC, xClass Other 1/Other 2 uploads, and the MS ECC closeout email. CM Working List is not applicable for this final MS ECC closeout path.`;
  }

  if (command.status === "NCDOC/xClass") {
    return `${action} ${result.crNumber} in ${location} and moved it to NCDOC/xClass records work${scope}.${owner}${previous} It will not show closed until NCDOC, xClass, and IPT notification are complete.`;
  }

  if (command.status === "Pending OOC Approvals") {
    return `${action} ${result.crNumber} in ${location} and moved it into OOC approvals${scope}.${owner}${previous} The workflow view will update from the CR register.`;
  }

  if (command.status === "CM Working List") {
    const cmState =
      command.cmWorkingListStatus === "Complete"
        ? "marked the CM Working List task complete"
        : "moved it into CM Working List readiness";
    return `${action} ${result.crNumber} in ${location} and ${cmState}${scope}.${owner}${previous} The workflow view will update from the CR register.`;
  }

  return `${action} ${result.crNumber} in ${location}.${owner} The workflow view will update from the CR register.`;
}

async function readProcessKnowledge() {
  try {
    return await readFile(
      path.join(process.cwd(), "docs", "ecc-process-knowledge.md"),
      "utf8",
    );
  } catch {
    return "No ECC process knowledge file was available.";
  }
}

function normalizeMessages(messages: IncomingMessage[]) {
  return messages
    .filter(
      (message) =>
        (message.role === "assistant" || message.role === "user") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    )
    .slice(-10)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4000),
    }));
}
