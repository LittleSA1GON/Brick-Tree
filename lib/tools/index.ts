import { ToolRegistry } from "@/lib/tools/registry";
import { academicSearchTool } from "@/lib/tools/implementations/academic-search";
import { webSearchTool } from "@/lib/tools/implementations/web-search";
import { knowledgeSearchTool } from "@/lib/tools/implementations/knowledge-search";
import { uploadedDocumentSearchTool } from "@/lib/tools/implementations/uploaded-document-search";

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(academicSearchTool)
    .register(webSearchTool)
    .register(knowledgeSearchTool)
    .register(uploadedDocumentSearchTool);
}
