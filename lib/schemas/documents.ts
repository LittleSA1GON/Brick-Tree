import { z } from "zod";

export const DocumentSectionSchema = z.object({
  id: z.string().min(1).max(160),
  heading: z.string().max(240).optional(),
  text: z.string().min(1).max(12_000),
  page: z.number().int().positive().optional(),
});
export type DocumentSection = z.infer<typeof DocumentSectionSchema>;

export const ExtractedDocumentSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(240),
  fileName: z.string().min(1).max(260),
  mimeType: z.string().max(160).optional(),
  sections: z.array(DocumentSectionSchema).min(1).max(40),
  metadata: z
    .object({
      authors: z.array(z.string().max(160)).max(20).optional(),
      publicationDate: z.string().max(80).optional(),
      doi: z.string().max(160).optional(),
      pageCount: z.number().int().positive().max(20_000).optional(),
    })
    .optional(),
});
export type ExtractedDocument = z.infer<typeof ExtractedDocumentSchema>;

export const RetrievedChunkSchema = z.object({
  id: z.string().min(1).max(240),
  text: z.string().min(1).max(20_000),
  source: z.string().max(260).optional(),
  title: z.string().max(300).optional(),
  score: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type RetrievedChunk = z.infer<typeof RetrievedChunkSchema>;

