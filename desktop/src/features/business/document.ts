import { z } from "zod";

export { BUSINESS_CHANNEL_DESCRIPTION } from "@/shared/lib/appWorkspaceChannel";
export const MAX_DOCUMENT_BYTES = 200_000;

const text = z.string().max(12_000);
const sourceSchema = z
  .object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(300),
    kind: z.enum(["note", "url", "file"]),
    content: z.string().max(40_000),
    url: z
      .url()
      .max(2_000)
      .refine((url) => /^https?:\/\//.test(url))
      .optional(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const businessDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("aios.business-workspace"),
    company: z
      .object({
        name: z.string().max(300),
        website: z.string().max(2_000),
        summary: text,
        audience: text,
        offers: text,
        goals: text,
      })
      .strict(),
    sources: z.array(sourceSchema).max(100),
    connections: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            provider: z.string().min(1).max(100),
            label: z.string().min(1).max(300),
            status: z.enum(["not_configured", "connected", "error"]),
            details: z.string().max(2_000).optional(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .superRefine((doc, ctx) => {
    for (const collection of ["sources", "connections"] as const) {
      const ids = new Set<string>();
      for (const row of doc[collection]) {
        if (ids.has(row.id))
          ctx.addIssue({
            code: "custom",
            message: "Duplicate record id",
            path: [collection],
          });
        ids.add(row.id);
      }
    }
  });

export type BusinessDocument = z.infer<typeof businessDocumentSchema>;
export type BusinessSource = BusinessDocument["sources"][number];

export function newBusinessDocument(name = ""): BusinessDocument {
  return {
    schemaVersion: 1,
    kind: "aios.business-workspace",
    company: {
      name,
      website: "",
      summary: "",
      audience: "",
      offers: "",
      goals: "",
    },
    sources: [],
    connections: [],
  };
}

export function parseBusinessDocument(content: string): BusinessDocument {
  if (new TextEncoder().encode(content).length > MAX_DOCUMENT_BYTES) {
    throw new Error(
      "This workspace is too large. Export or shorten sources before saving.",
    );
  }
  const result = businessDocumentSchema.safeParse(JSON.parse(content));
  if (!result.success) {
    throw new Error(
      "This is not a supported business workspace. Its content has been preserved.",
    );
  }
  return result.data;
}

export function serializeBusinessDocument(document: BusinessDocument): string {
  const content = JSON.stringify(document, null, 2);
  parseBusinessDocument(content);
  return content;
}

/** Completeness is a navigation aid, never a claim that the agent knows the business. */
export function businessProgress(
  document: BusinessDocument,
  hasVerifiedConnection = false,
) {
  return [
    {
      title: "Describe your business",
      done: Boolean(document.company.summary.trim()),
    },
    { title: "Add a trusted source", done: document.sources.length > 0 },
    {
      title: "Clarify your priorities",
      done: Boolean(document.company.goals.trim()),
    },
    {
      title: "Connect a working tool",
      done: hasVerifiedConnection,
    },
  ];
}
